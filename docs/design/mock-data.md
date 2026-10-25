# Mock data

The prototype runs on a fixed, deterministic dataset (MOCK-02, MOCK-04). The implementation should ship
an equivalent fixture so screens and tests start from the same state. Generator and values:
`seed()`, `history()`, `todaySessions()` and `genLog()` in [`prototype/app.dc.html`](prototype/app.dc.html).

## Clock

The snapshot is **today (Oct 24), 14:32:00**. Day indexes count back from today (`day: 0` = today,
`day: 29` = Sep 25).

## Agents

| Id | Kind | State at 14:32 | Ticket | Shows |
|---|---|---|---|---|
| `alpha` | Real · Claude Code | Implementing, Edit running | T-12 | Said-vs-did mismatch 14:05–14:16 (reported Testing, ran no commands) |
| `bravo` | Real · Claude Code | Testing, Bash running | T-9 | Long-running tool keeps the agent Online |
| `charlie` | Real · Claude Code | Idle | — | Free agent for assignment |
| `sim-1` | Simulated | Planning, **blocked** | T-8 | Blocked question for the Operator |
| `sim-2` | Simulated | Awaiting Review, **Stale** | T-7 | Last tool failed (lint) |
| `sim-3` | Simulated | Awaiting Review, **Offline** | T-6 | Silent agent (never acts) |

## Tickets

T-1 … T-5 Done · T-6, T-7 Review · T-8 (blocked), T-9, T-12 In Progress · T-10, T-11, T-13 Ready ·
T-14 … T-16 Backlog. Titles, descriptions and acceptance criteria are in `seed()`.

## Sessions and tokens

- 114 historical sessions over the last 29 days, generated with a fixed-seed PRNG (seed `20261024`),
  weekends lighter; plus 7 sessions today (`S-0401` … `S-0415`), of which `S-0409` is a hand-written
  full log and `S-0412` … `S-0415` are still running.
- Every log entry that costs tokens carries `tok: { i, o, cr, cw }` (input, output, cache read,
  cache write): agent replies, every tool call, and the session start (context load).
  **A session's total equals the sum of its entries** (MOCK-03).
- Activities for "where the tokens went": Reasoning & replies, Reading code (Read, Grep),
  Editing code (Edit), Running commands (Bash), Agent Ops (MCP calls), Session context.

## Model prices (mock, USD per 1M tokens)

| Model | Input | Output | Cache read | Cache write |
|---|---|---|---|---|
| `opus-5-5` | 15.00 | 75.00 | 1.50 | 18.75 |
| `sonnet-5-5` | 3.00 | 15.00 | 0.30 | 3.75 |
| `haiku-5-5` | 0.80 | 4.00 | 0.08 | 1.00 |

Cost = Σ tokens × price per type (CST-08). These prices are placeholders, labelled `MOCK` in the UI.
