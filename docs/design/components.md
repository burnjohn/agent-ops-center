# Components

Catalogue of the UI building blocks used by the prototype (`prototype/app.dc.html`). Each entry lists
what it shows, its states and the tokens it uses. Names are suggestions for the component library;
the stack is not chosen yet (see ADR-0005, proposed).

Global rules:

- Square corners everywhere (`--radius: 0`). Borders are 1 px; `--line` between rows, `--line-strong`
  for controls and section starts. No shadows except the focus ring and the `--live` "just updated" ring.
- Every state has a glyph or label as well as colour: `■ ONLINE`, `◐ STALE`, `□ OFFLINE`,
  `● RUNNING`, `✓` ok, `▲` failed, `● Operator`, `■ Agent Report`, `◆ Agent Telemetry`.
- Labels, ids, times and numbers use `--font-mono`; numbers are `tabular-nums`.
- Interactive targets are at least 40 px high (44 px for primary actions); focus is `--focus`.

## App shell

| Component | Contents | States / notes |
|---|---|---|
| `AppHeader` | Brand block (ink fill, 2×2 square mark with one `--attn` square), primary nav, theme toggle, `LOCAL · NO AUTH` label | Stays the same on every screen |
| `PrimaryNav` | `01 Board`, `02 Mission Control`, `03 Usage & Cost` + dashed `MOCK` tag | Active: weight 600 + 3 px ink underline; Board shows an `--attn` badge `N BLOCKED`. Clicking a nav item clears the back history |
| `BackBar` | `← BACK TO <previous screen>` button + breadcrumb | On ticket, agent and session pages. Back walks the visit history; never changes filters |
| `MockBanner` | Diagonal-stripe strip, `MOCK DATA` + one-line explanation | Usage & Cost and Session Log (MOCK-01) |
| `Toast` | Ink box, mono 12 px, bottom centre, `aria-live="polite"` | Auto-hides after ~3.4 s |

## Controls

| Component | Contents | States / notes |
|---|---|---|
| `Button` | Text, optional leading glyph | `default` (outline), `primary` (ink fill), `sm` (32 px, mono 11 px), `disabled` (40 % opacity + reason in `title`) |
| `Segmented` | Row of `seg` buttons sharing borders | Selected: ink fill, `aria-pressed="true"`. Used for period, log filters, priority, Event Log source, session tabs |
| `Select` | Native `<select>` with visible label | Agent filter, Model filter, Event Log category |
| `Checkbox` | Native checkbox, accent `#FF4F00` | `Blocked only` |
| `TextField` / `TextArea` | 1 px ink border, square | Error text below in `--attn-ink` with `role="alert"`; required mark `*` in `--attn-ink` |
| `Modal` | 50 % black scrim, square panel, title row, body, action row | Types: New ticket, Assign agent, Request changes comment, Confirm move away from agent |

## Data display

| Component | Contents | States / notes |
|---|---|---|
| `KpiTile` | Mono label, 40–44 px light number, optional sub-line or sparkline | Can be a link (Blocked → Board) |
| `PriorityBars` | Three 3 px bars of height 5/8/11 + `HIGH`/`MEDIUM`/`LOW` | Filled bars = level |
| `StageStepper` | Four 3–4 px segments `PLAN · IMPL · TEST · REVIEW`, optional labels | Current = ink, passed = muted, future = line. `Idle` = all empty |
| `HealthBadge` | Mono glyph + word | `■ ONLINE` ink, `◐ STALE` attn-ink, `□ OFFLINE` muted |
| `ToolStatus` | Box with dot, tool name, argument, time | `running` (ink border, `--live` dot), `blocked` (attn fill), `failed` (attn-ink border on attn-bg, triangle), `waiting for review` / `idle` / `no activity` (dashed line, muted) |
| `SourceMark` | `●` / `■` / `◆` before an event | Operator / Agent Report / Agent Telemetry |
| `EventRow` | Time · source mark · agent link · text · ticket link | Warning rows in `--attn-ink`, weight 500 |
| `DataTable` | Mono 10.5 px headers, 44 px rows, hover `--bg-sub`, whole row clickable + a link in the first cell | Sortable headers are buttons with `aria-sort`; `Show 12 more` pager |
| `BreakdownList` | Name · cost · share %, 3 px share bar under each row | Rows are links (agent, ticket, model filter, activity) |
| `BarChart (daily cost)` | 30 vertical bars, 3 gridlines, mono axis | Bars in the selected period = ink, others = line; today has a `--live` top edge |

## Domain components

| Component | Contents | States / notes |
|---|---|---|
| `TicketCard` | Id · priority · flags, title, blocked reason, stage stepper + agent + stage + age, last update | `default`, `blocked` (attn fill, `■ BLOCKED`), `just updated` (`--live` ring, `UPDATED`), `done` (muted, transparent), `dragging` (35 % opacity, dashed). Draggable unless filtering prevents it |
| `BoardColumn` | Number, name, big count, drop hint, cards | While dragging: accepting column = `--bg-sub` + `--live` inset ring (3 px when hovered) + `↓ DROP — <what happens>`; refusing column = 40 % opacity + `⊘ <reason>` |
| `AgentCard` | Name, kind, health, ticket link, stage stepper with labels, tool status, seen/cost footer, `LOG ↗` | Whole card opens the agent; Offline = `--bg-sub` + 75 % opacity |
| `ReviewPanel` | Summary, result link (PR/branch), Approve / Request changes | Request changes opens a required comment field |
| `BlockedPanel` | Attn header, agent's question, required answer field, `Send answer & unblock` | |
| `AgentConsole` | Fixed dark terminal (`--console-*`), mono 12.5 px, newest at the bottom (`column-reverse` scroll) | Line kinds: `operator`, `system`, `stage` (`── PLANNING ──` in console-stage), `agent` (+ token line), `$ tool` / `✗ tool` (+ `→ result · Ns`, token line, full output block). Session tabs, `NEXT STEP`, `RUN TO NEXT STAGE`, `FULL LOG →`, tail line `▍ waiting for …` |
| `SessionLogEntry` | Time + one of: operator bubble, agent text + tokens, tool box (mark, name, argument, result, duration, tokens, output collapsed to 4 lines), stage rule, system line | Failed tool: attn-ink border on attn-bg; current error: 3 px `--attn` ring |
| `TokenCells` | Input / Output / Cache read / Cache write tokens with cost each, plus ink-filled total cost cell | Running session says `COST SO FAR` |
| `TokenActivityTable` | "Where the tokens went": activity · steps · 4 token types · cost · share bar | Activities: Reasoning & replies, Reading code, Editing code, Running commands, Agent Ops (MCP calls), Session context. Row click filters the log |
| `SaidVsDidTable` | Time · SAID (Agent Report) · DID (Agent Telemetry) | Mismatch rows on `--attn-bg`, `▲ N MISMATCH` badge, note under the table |
