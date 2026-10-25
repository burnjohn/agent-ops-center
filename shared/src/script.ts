import { z } from 'zod';

/** Simulation script stored in `agent_sim_state.script` (spec C7). Opaque to the UI; versioned. */
export const SCRIPT_VERSION = 1 as const;

export const ScriptAction = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('tool'),
      tool: z.string().min(1),
      arg: z.string(),
      fail: z.boolean(),
    })
    .strict(),
  z.object({ kind: z.literal('message'), text: z.string() }).strict(),
  z
    .object({
      kind: z.literal('update'),
      progress: z.number().int().min(0).max(100),
      text: z.string(),
    })
    .strict(),
  z.object({ kind: z.literal('stage'), to: z.enum(['implementing', 'testing']) }).strict(),
  z.object({ kind: z.literal('block'), question: z.string() }).strict(),
  z.object({ kind: z.literal('read_answer'), text: z.string() }).strict(),
  z.object({ kind: z.literal('read_comment'), text: z.string() }).strict(),
  z.object({ kind: z.literal('submit'), summary: z.string(), resultLink: z.string() }).strict(),
]);
export type ScriptAction = z.infer<typeof ScriptAction>;

export const AgentScript = z
  .object({
    version: z.literal(SCRIPT_VERSION),
    queue: z.array(ScriptAction),
    askedTicketIds: z.array(z.string()),
    prngState: z.number().int(),
  })
  .strict();
export type AgentScript = z.infer<typeof AgentScript>;
