import type { TokenUsage } from '@agent-ops/shared';

/**
 * Port of the prototype's mock token model (`hashK`, `toolTok`, `ctxTok`, `toolOut` in
 * docs/design/prototype/app.dc.html). Deterministic: the same entry always yields the same tokens
 * (API-AC-57).
 */
export interface TokenSource {
  type: string;
  tool?: string | null;
  arg?: string | null;
  text?: string | null;
  /** Clock key of the entry; the prototype uses seconds on its timeline. */
  t: number | string;
  ok?: boolean | null;
  result?: string | null;
  /** Prototype `d` (duration seconds); varies the Edit/Bash mock output. */
  d?: number | null;
}

export function hashK(e: TokenSource): number {
  const s = (e.tool || e.type) + (e.arg || e.text || '') + String(e.t);
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100003;
  return h;
}

const usage = (i: number, o: number, cr: number, cw: number): TokenUsage => ({
  input: i,
  output: o,
  cacheRead: cr,
  cacheWrite: cw,
});

export function toolTok(e: TokenSource): TokenUsage {
  const k = hashK(e);
  const r = (lo: number, span: number): number => lo + ((k * 7919) % span);
  const name = e.tool || '';
  if (name.startsWith('agent-ops'))
    return usage(r(200, 600), 40 + (k % 80), r(15000, 60000), 100 + (k % 400));
  if (name === 'Read') return usage(r(1500, 6000), 60 + (k % 80), r(20000, 120000), r(400, 2000));
  if (name === 'Grep') return usage(r(400, 1100), 40 + (k % 60), r(18000, 90000), 200 + (k % 600));
  if (name === 'Edit') return usage(r(800, 1200), r(600, 2400), r(20000, 140000), r(300, 1500));
  if (name === 'Bash') {
    return usage(
      r(600, e.ok === false ? 9000 : 3000),
      60 + (k % 90),
      r(25000, 150000),
      r(300, 1800),
    );
  }
  return usage(r(300, 900), 50 + (k % 80), r(15000, 60000), 200 + (k % 500));
}

/** Tokens of the "Session started…" system entry. */
export function ctxTok(e: TokenSource): TokenUsage {
  const k = hashK(e);
  return usage(3200 + (k % 900), 0, 0, 21000 + ((k * 31) % 6000));
}

/** Mock tool output; null for tools without one. */
export function toolOut(e: TokenSource): string | null {
  const g = e.d || 0;
  const name = e.tool || '';
  const arg = e.arg ?? '';
  if (name === 'Read') {
    return `${e.result || ''} read from ${arg}\n  1 │ // ${arg.split('/').pop()}\n  2 │ import { events } from '../events/store'\n  3 │ …`;
  }
  if (name === 'Grep') {
    return e.result === '0 MATCHES'
      ? 'no matches'
      : `${arg.replace(/"/g, '')}\n  src/${(arg.match(/"(.*)"/) || ['', 'x'])[1]}.ts:12`;
  }
  if (name === 'Edit') {
    return `@@ -12,4 +12,${6 + (g % 9)} @@\n-  const cursor = 0\n+  const cursor = parseCursor(input)\n+  if (cursor < 0) return []`;
  }
  if (name === 'Bash') {
    return arg.includes('typecheck')
      ? '> tsc --noEmit\nFound 0 errors.'
      : `> vitest run\n ✓ ${8 + (g % 9)} tests passed\nTime: ${2 + (g % 5)}.${g % 9} s`;
  }
  return null;
}
