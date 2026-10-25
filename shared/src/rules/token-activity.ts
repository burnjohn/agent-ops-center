import type { LogEntryType, TokenActivity } from '../enums.js';

export interface ActivityEntry {
  type: LogEntryType;
  /** Tool name for `tool` entries. */
  tool?: string | null;
  /** Entry text, used for the `system` "Session started…" check. */
  text?: string | null;
}

/** SPEC-server-api §C1 token activity mapping (LOG-08, CST-04). */
export function tokenActivityOf(entry: ActivityEntry): TokenActivity {
  switch (entry.type) {
    case 'agent':
      return 'reasoning_replies';
    case 'tool': {
      const tool = entry.tool ?? '';
      if (tool === 'Read' || tool === 'Grep') return 'reading_code';
      if (tool === 'Edit') return 'editing_code';
      if (tool === 'Bash') return 'running_commands';
      if (tool.startsWith('agent-ops')) return 'agent_ops';
      return 'other';
    }
    case 'system':
      return (entry.text ?? '').startsWith('Session started') ? 'session_context' : 'other';
    default:
      return 'other';
  }
}
