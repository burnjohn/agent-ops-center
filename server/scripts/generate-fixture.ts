/**
 * Dev tooling (outside `server/src`): generates `server/fixture/fixture.json` from the prototype's own
 * generator code (`seed()`, `history()`, `todaySessions()`, `enrich()`), per SPEC-database §4.
 *
 *   pnpm --filter @agent-ops/server fixture:generate            write server/fixture/fixture.json
 *   pnpm --filter @agent-ops/server fixture:generate -- --check generate in memory, compare to the committed
 *                                                               file and print the golden numbers
 *
 * The prototype is trusted repo content, but its class is still evaluated in an empty `node:vm` context:
 * the only global it sees is a stub `DCLogic` base class (no `require`, no `process`).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { EVENT_PAYLOADS, Event, tokenActivityOf } from '@agent-ops/shared';
import {
  parseFixtureData,
  type FixtureAgent,
  type FixtureAgentSimState,
  type FixtureData,
  type FixtureEvent,
  type FixtureLogEntry,
  type FixtureSession,
  type FixtureTicket,
} from '../src/infrastructure/fixture/fixture-data.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PROTOTYPE = resolve(ROOT, 'docs/design/prototype/app.dc.html');
const OUT = resolve(ROOT, 'server/fixture/fixture.json');

const SEED = 20261024;
const DAY0 = Date.UTC(2026, 9, 24); // fixture day, 2026-10-24T00:00:00Z

// ---------------------------------------------------------------------------------------------------------
// Prototype evaluation (node:vm)
// ---------------------------------------------------------------------------------------------------------

/** Loosely typed view of what the prototype produces (JSON-normalised, so no foreign-realm objects). */
interface ProtoTok {
  i: number;
  o: number;
  cr: number;
  cw: number;
}
interface ProtoEntry {
  t: number;
  type: string;
  text?: string;
  tool?: string;
  arg?: string;
  ok?: boolean;
  result?: string;
  d?: number;
  out?: string | null;
  tok?: ProtoTok;
}
interface ProtoSession {
  id: string;
  agent: string;
  ticket: string | null;
  model: string;
  day: number;
  start: number;
  end: number | null;
  status: string;
  log: ProtoEntry[];
}
interface ProtoTicket {
  id: string;
  title: string;
  prio: string;
  status: string;
  desc: string;
  ac: string[];
  assignee: string | null;
  blocked: string | null;
  answer: string | null;
  reviewComment: string | null;
  summary: string | null;
  pr: string | null;
  update: string | null;
  updatedAt: number;
  asked: boolean;
  created: number;
}
interface ProtoAgent {
  id: string;
  kind: string;
  stage: string;
  ticket: string | null;
  lastSeen: number;
  session: string | null;
  tool: { name: string; arg: string; state: string; started: number; fail: boolean } | null;
  lastTool: { name: string; arg: string; state: string; at: number } | null;
  queue: unknown[][];
  cooldown: number;
  refusal: string | null;
  frozen: boolean;
}
interface ProtoEvent {
  s: number;
  src: string;
  cat: string;
  agent: string | null;
  ticket: string | null;
  text: string;
  warn: boolean;
}
interface ProtoState {
  clock: number;
  tickets: ProtoTicket[];
  agents: ProtoAgent[];
  events: ProtoEvent[];
  sessions: ProtoSession[];
  nextTicket: number;
  nextSession: number;
  prices: Record<string, number[]>;
}

function extractClassSource(html: string): string {
  const start = html.indexOf('class Component extends DCLogic {');
  if (start < 0) throw new Error('prototype: `class Component extends DCLogic` not found');
  const end = html.indexOf('</script>', start);
  if (end < 0) throw new Error('prototype: closing </script> not found');
  const body = html.slice(start, end).trimEnd();
  if (!body.endsWith('}')) throw new Error('prototype: class block does not end with `}`');
  return body;
}

function runPrototype(): ProtoState {
  const classSource = extractClassSource(readFileSync(PROTOTYPE, 'utf8'));
  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
  });
  const program = [
    'class DCLogic { constructor(props) { this.props = props || {}; } setState() {} }',
    classSource,
    'const inst = new Component({ theme: "light" });',
    // `seed()` is called in the constructor too; calling it again is pure (no randomness outside seeded PRNGs).
    'JSON.stringify(Object.assign({}, inst.seed(), { prices: inst.P }));',
  ].join('\n');
  const json = vm.runInContext(program, context, { timeout: 30_000 }) as string;
  return JSON.parse(json) as ProtoState;
}

// ---------------------------------------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------------------------------------

const iso = (day: number, seconds: number): string =>
  new Date(DAY0 - day * 86_400_000 + seconds * 1000).toISOString().replace('.000Z', 'Z');
const slug = (s: string): string => s.toLowerCase().replace(/ /g, '_');
const hms = (s: number): string => iso(0, s).slice(11, 19);

const TICKET_STATUS = (s: string) => slug(s) as FixtureTicket['status'];
const STAGE = (s: string) => slug(s) as FixtureAgent['stage'];

const MODEL_BY_AGENT: Record<string, string> = {
  alpha: 'sonnet-5-5',
  bravo: 'opus-5-5',
  charlie: 'haiku-5-5',
  'sim-1': 'sonnet-5-5',
  'sim-2': 'sonnet-5-5',
  'sim-3': 'sonnet-5-5',
};
const SCENARIO: Record<string, string> = {
  alpha: 'said_vs_did',
  bravo: 'long_running_tool',
  charlie: 'free_agent',
  'sim-1': 'blocked_on_question',
  'sim-2': 'stale_after_failed_lint',
  'sim-3': 'silent',
};

function mapTicket(t: ProtoTicket, nowSeconds: number): FixtureTicket {
  const createdSec = t.id === 'T-7' ? 9 * 3600 + 12 * 60 : 8 * 3600 + t.created;
  const updatedSec =
    t.updatedAt > 0 ? t.updatedAt : t.id === 'T-5' ? 14 * 3600 + 12 * 60 + 30 : createdSec;
  if (updatedSec > nowSeconds) throw new Error(`${t.id}: updated after the fixture clock`);
  return {
    id: t.id as FixtureTicket['id'],
    number: t.created,
    title: t.title,
    description: t.desc,
    acceptanceCriteria: t.ac,
    priority: slug(t.prio) as FixtureTicket['priority'],
    status: TICKET_STATUS(t.status),
    assigneeId: t.assignee,
    blockedQuestion: t.blocked,
    answer: t.answer,
    reviewSummary: t.summary,
    resultLink: t.pr,
    reviewComment: t.reviewComment,
    lastUpdateText: t.update,
    lastUpdateAt: t.update === null ? null : iso(0, updatedSec),
    createdAt: iso(0, createdSec),
    updatedAt: iso(0, updatedSec),
  };
}

function mapEntry(e: ProtoEntry, ordinal: number, day: number): FixtureLogEntry {
  const kind = e.type as FixtureLogEntry['kind'];
  let stage: FixtureLogEntry['stage'] = null;
  if (kind === 'stage') {
    const m = /^STAGE → (.+)$/.exec(e.text ?? '');
    if (!m) throw new Error(`unparseable stage entry: ${e.text}`);
    stage = STAGE(m[1]!);
  }
  const isTool = kind === 'tool';
  const tokens = e.tok
    ? { input: e.tok.i, output: e.tok.o, cacheRead: e.tok.cr, cacheWrite: e.tok.cw }
    : null;
  return {
    ordinal,
    at: iso(day, e.t),
    kind,
    text: kind === 'tool' || kind === 'stage' ? null : (e.text ?? null),
    stage,
    toolName: isTool ? (e.tool ?? null) : null,
    toolArg: isTool ? (e.arg ?? null) : null,
    toolOk: isTool ? (e.ok ?? null) : null,
    toolResult: isTool ? (e.result ?? null) : null,
    toolDurationSec: isTool ? (e.d ?? 0) : null,
    toolOutput: isTool ? (e.out ?? null) : null,
    tokens,
    tokenActivity: tokens
      ? tokenActivityOf({ type: kind, tool: e.tool ?? null, text: e.text ?? null })
      : null,
  };
}

function mapSession(s: ProtoSession): FixtureSession {
  return {
    id: s.id as FixtureSession['id'],
    number: Number(s.id.slice(2)),
    agentId: s.agent,
    ticketId: s.ticket as FixtureSession['ticketId'],
    model: s.model,
    status: slug(s.status) as FixtureSession['status'],
    startedAt: iso(s.day, s.start),
    endedAt: s.end === null ? null : iso(s.day, s.end),
    entries: s.log.map((e, i) => mapEntry(e, i, s.day)),
  };
}

const kindOfAction = (a: unknown[]): string => String(a[0]);
function mapScript(queue: unknown[][], asked: string[]): FixtureAgentSimState['script'] {
  const q = queue.map((a): FixtureAgentSimState['script']['queue'][number] => {
    switch (kindOfAction(a)) {
      case 'msg':
        return { kind: 'message', text: String(a[1]) };
      case 'update':
        return { kind: 'update', progress: Number(a[1]), text: String(a[2]) };
      case 'stage':
        return { kind: 'stage', to: slug(String(a[1])) as 'implementing' | 'testing' };
      case 'tool':
        return { kind: 'tool', tool: String(a[1]), arg: String(a[2]), fail: a[3] === true };
      case 'block':
        return { kind: 'block', question: String(a[1]) };
      case 'answer':
        return { kind: 'read_answer', text: String(a[1]) };
      case 'review':
        return { kind: 'read_comment', text: String(a[1]) };
      case 'submit':
        return { kind: 'submit', summary: String(a[1]), resultLink: String(a[2]) };
      default:
        throw new Error(`unknown prototype queue action: ${kindOfAction(a)}`);
    }
  });
  return { version: 1, queue: q, askedTicketIds: asked, prngState: SEED };
}

function mapAgent(a: ProtoAgent): FixtureAgent {
  return {
    id: a.id,
    name: a.id,
    kind: slug(a.kind) as FixtureAgent['kind'],
    model:
      MODEL_BY_AGENT[a.id] ??
      (() => {
        throw new Error(`no model for agent ${a.id}`);
      })(),
    stage: STAGE(a.stage),
    currentTicketId: a.ticket as FixtureAgent['currentTicketId'],
    currentSessionId: a.session as FixtureAgent['currentSessionId'],
    currentToolName: a.tool?.name ?? null,
    currentToolArg: a.tool?.arg ?? null,
    currentToolStartedAt: a.tool ? iso(0, a.tool.started) : null,
    lastToolName: a.lastTool?.name ?? null,
    lastToolArg: a.lastTool?.arg ?? null,
    lastToolOk: a.lastTool ? a.lastTool.state !== 'fail' : null,
    lastToolAt: a.lastTool ? iso(0, a.lastTool.at) : null,
    lastSeenAt: iso(0, a.lastSeen),
    createdAt: iso(29, 0),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Events (§4.5)
// ---------------------------------------------------------------------------------------------------------

function mapEvents(
  proto: ProtoState,
  sessions: ProtoSession[],
  tickets: FixtureTicket[],
): FixtureEvent[] {
  const today = sessions.filter((s) => s.day === 0);
  const stageOf = new Map<string, string>();
  const ticketById = new Map(tickets.map((t) => [t.id, t]));
  const covering = (agent: string | null, sec: number): ProtoSession | null =>
    agent === null
      ? null
      : (today.find(
          (s) => s.agent === agent && s.start <= sec && (s.end === null || sec <= s.end),
        ) ?? null);

  return proto.events.map((e, idx): FixtureEvent => {
    const session = covering(e.agent, e.s);
    const base = {
      at: iso(0, e.s),
      agentId: e.agent,
      ticketId: e.ticket as FixtureEvent['ticketId'],
      sessionId: (session?.id ?? null) as FixtureEvent['sessionId'],
      warn: e.warn,
    };
    const summary = e.text;
    const fail = (m: string): never => {
      throw new Error(`event #${idx + 1} (${e.text}): ${m}`);
    };
    const source =
      ({ op: 'operator', rep: 'agent_report', tel: 'agent_telemetry' } as const)[e.src as 'op'] ??
      fail(`bad src ${e.src}`);
    let m: RegExpExecArray | null;

    const mk = (type: FixtureEvent['type'], payload: Record<string, unknown>): FixtureEvent => ({
      ...base,
      source,
      category: e.cat as FixtureEvent['category'],
      type,
      payload: { summary, ...payload },
    });

    if ((m = /^Created (T-\d+)$/.exec(e.text))) {
      const t = ticketById.get(m[1] as FixtureTicket['id']) ?? fail('unknown ticket');
      // Ticket as it was when created: Backlog, unassigned, nothing reported yet.
      const created = {
        id: t!.id,
        number: t!.number,
        title: t!.title,
        description: t!.description,
        acceptanceCriteria: t!.acceptanceCriteria,
        priority: t!.priority,
        status: 'backlog',
        assigneeId: null,
        blockedQuestion: null,
        answer: null,
        reviewSummary: null,
        resultLink: null,
        reviewComment: null,
        lastUpdate: null,
        createdAt: base.at,
        updatedAt: base.at,
      };
      return mk('ticket.created', { ticket: created });
    }
    if ((m = /^Moved (.+) → (.+)$/.exec(e.text)))
      return mk('ticket.moved', { from: slug(m[1]!), to: slug(m[2]!) });
    if (/^Approved T-\d+$/.test(e.text)) {
      const t = ticketById.get(e.ticket as FixtureTicket['id']);
      if (!t?.assigneeId) fail('approved ticket has no assignee');
      return mk('ticket.approved', { agentId: t!.assigneeId });
    }
    if (/^Claimed T-\d+$/.test(e.text)) {
      if (!session || !e.agent) fail('claim without a covering session');
      return mk('ticket.assigned', {
        from: 'ready',
        agentId: e.agent,
        sessionId: session!.id,
        claim: true,
      });
    }
    if ((m = /^Stage → (.+)$/.exec(e.text))) {
      const to = slug(m[1]!);
      const prev = stageOf.get(e.agent ?? '');
      const from = prev !== undefined && prev !== to ? prev : 'idle';
      stageOf.set(e.agent ?? '', to);
      return mk('agent.stage_changed', { from, to });
    }
    if ((m = /^Submitted for review · (.+)$/.exec(e.text))) {
      const t = ticketById.get(e.ticket as FixtureTicket['id']) ?? fail('unknown ticket');
      return mk('ticket.submitted', { reviewSummary: t!.reviewSummary ?? '', resultLink: m[1]! });
    }
    if ((m = /^Blocked · (.+)$/.exec(e.text))) return mk('ticket.blocked', { question: m[1]! });
    if ((m = /^Update · (.+) · (\d+)%$/.exec(e.text)))
      return mk('ticket.updated', { text: m[1]!, progress: Number(m[2]) });
    if (e.text === 'Connected') return mk('agent.connected', {});
    if (e.text === 'Checked review status') return mk('agent.heartbeat', {});
    if ((m = /^(\S+) started · (.+)$/.exec(e.text)))
      return mk('tool.started', { tool: m[1]!, arg: m[2]! });
    if ((m = /^(\S+) ok · (.+)$/.exec(e.text))) {
      const entry = session?.log.find(
        (x) => x.type === 'tool' && x.t === e.s && x.tool === m![1] && x.arg === m![2],
      );
      const result = entry?.result ?? (m[1] === 'Bash' ? 'EXIT 0' : '');
      return mk('tool.finished', { tool: m[1]!, arg: m[2]!, durationSec: entry?.d ?? 0, result });
    }
    if ((m = /^(\S+) failed · (.+) · exit (\d+)$/.exec(e.text))) {
      return mk('tool.failed', { tool: m[1]!, arg: m[2]!, durationSec: 0, result: `EXIT ${m[3]}` });
    }
    return fail('no §4.5 pattern matches');
  });
}

// ---------------------------------------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------------------------------------

function build(): FixtureData {
  const proto = runPrototype();
  const nowSeconds = proto.clock;
  if (hms(nowSeconds) !== '14:32:00')
    throw new Error(`unexpected prototype clock ${hms(nowSeconds)}`);

  const tickets = proto.tickets.map((t) => mapTicket(t, nowSeconds));
  const sessions = proto.sessions.map(mapSession);
  const askedBy = (agent: string): string[] =>
    proto.tickets.filter((t) => t.asked && t.assignee === agent).map((t) => t.id);

  const data: FixtureData = {
    version: 1,
    seed: SEED,
    clockAt: iso(0, nowSeconds),
    nextTicketNumber: proto.nextTicket,
    nextSessionNumber: proto.nextSession,
    modelPrices: Object.entries(proto.prices).map(([model, p]) => ({
      model,
      inputPerM: p[0]!.toFixed(2),
      outputPerM: p[1]!.toFixed(2),
      cacheReadPerM: p[2]!.toFixed(2),
      cacheWritePerM: p[3]!.toFixed(2),
    })),
    tickets,
    agents: proto.agents.map(mapAgent),
    agentSimStates: proto.agents.map((a) => ({
      agentId: a.id,
      scenario:
        SCENARIO[a.id] ??
        (() => {
          throw new Error(`no scenario for ${a.id}`);
        })(),
      script: mapScript(a.queue, askedBy(a.id)),
      silent: a.frozen,
      pendingRefusalTicketId: a.refusal as FixtureAgentSimState['pendingRefusalTicketId'],
      cooldownSteps: a.cooldown,
    })),
    sessions,
    events: mapEvents(proto, proto.sessions, tickets),
  };

  // Every payload must satisfy the shared contract; also validate whole events as the journal would hold them.
  data.events.forEach((ev, i) => {
    Event.parse({ ...ev, seq: i + 1, realAt: ev.at });
    if (!(ev.type in EVENT_PAYLOADS)) throw new Error(`unknown event type ${ev.type}`);
  });
  return parseFixtureData(data);
}

// ---------------------------------------------------------------------------------------------------------
// Golden numbers (--check)
// ---------------------------------------------------------------------------------------------------------

interface Stats {
  agents: number;
  tickets: number;
  prices: number;
  sessions: number;
  running: number;
  failed: number;
  noTicket: number;
  withFailedTool: number;
  longest: number;
  longOutput: string[];
  entries: number;
  withTokens: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costCents: number;
  events: number;
}

function computeStats(d: FixtureData): Stats {
  const p100 = new Map(
    d.modelPrices.map((p) => [
      p.model,
      [p.inputPerM, p.outputPerM, p.cacheReadPerM, p.cacheWritePerM].map((x) =>
        BigInt(Math.round(Number(x) * 100)),
      ),
    ]),
  );
  const st: Stats = {
    agents: d.agents.length,
    tickets: d.tickets.length,
    prices: d.modelPrices.length,
    sessions: d.sessions.length,
    running: 0,
    failed: 0,
    noTicket: 0,
    withFailedTool: 0,
    longest: 0,
    longOutput: [],
    entries: 0,
    withTokens: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    costCents: 0,
    events: d.events.length,
  };
  let micro = 0n; // Σ tokens × (price × 100); dollars = micro / 1e8
  for (const s of d.sessions) {
    if (s.status === 'running') st.running++;
    if (s.status === 'failed') st.failed++;
    if (s.ticketId === null) st.noTicket++;
    if (s.entries.some((e) => e.kind === 'tool' && e.toolOk === false)) st.withFailedTool++;
    st.longest = Math.max(st.longest, s.entries.length);
    if (s.entries.some((e) => (e.toolOutput?.split('\n').length ?? 0) > 4))
      st.longOutput.push(s.id);
    const pr = p100.get(s.model) ?? [0n, 0n, 0n, 0n];
    st.entries += s.entries.length;
    for (const e of s.entries) {
      if (!e.tokens) continue;
      st.withTokens++;
      st.input += e.tokens.input;
      st.output += e.tokens.output;
      st.cacheRead += e.tokens.cacheRead;
      st.cacheWrite += e.tokens.cacheWrite;
      micro +=
        BigInt(e.tokens.input) * pr[0]! +
        BigInt(e.tokens.output) * pr[1]! +
        BigInt(e.tokens.cacheRead) * pr[2]! +
        BigInt(e.tokens.cacheWrite) * pr[3]!;
    }
  }
  st.costCents = Number((micro + 500_000n) / 1_000_000n);
  return st;
}

const nf = (n: number): string => n.toLocaleString('en-US').replace(/,/g, ' ');

const GOLDEN: Stats = {
  agents: 6,
  tickets: 16,
  prices: 3,
  sessions: 121,
  running: 4,
  failed: 9,
  noTicket: 19,
  withFailedTool: 10,
  longest: 23,
  longOutput: ['S-0409'],
  entries: 1918,
  withTokens: 1670,
  input: 10_753_797,
  output: 1_844_687,
  cacheRead: 179_299_980,
  cacheWrite: 8_523_948,
  costCents: 30519,
  events: 44,
};

function report(st: Stats): string[] {
  return [
    `${st.agents} agents, ${st.tickets} tickets, ${st.prices} prices`,
    `${st.sessions} sessions (${st.running} running, ${st.failed} failed, ${st.noTicket} without ticket, ${st.withFailedTool} with a failed tool call, longest ${st.longest} entries, only ${st.longOutput.join(', ') || 'none'} with output > 4 lines)`,
    `${nf(st.entries)} entries / ${nf(st.withTokens)} with tokens`,
    `totals ${nf(st.input)} / ${nf(st.output)} / ${nf(st.cacheRead)} / ${nf(st.cacheWrite)}, cost $${(st.costCents / 100).toFixed(2)}`,
    `${st.events} events`,
  ];
}

// ---------------------------------------------------------------------------------------------------------

const check = process.argv.includes('--check');
const data = build();
const text = `${JSON.stringify(data, null, 2)}\n`;

if (!check) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, text);
  console.log(`wrote ${OUT}`);
}

const stats = computeStats(data);
console.log(report(stats).join('\n'));

let ok = JSON.stringify(stats) === JSON.stringify(GOLDEN);
if (!ok) console.error('GOLDEN MISMATCH. expected:\n' + report(GOLDEN).join('\n'));
if (check) {
  const same = existsSync(OUT) && readFileSync(OUT, 'utf8') === text;
  console.log(
    same
      ? 'fixture.json is up to date'
      : 'fixture.json is missing or differs from the generator output',
  );
  ok = ok && same;
}
process.exit(ok ? 0 : 1);
