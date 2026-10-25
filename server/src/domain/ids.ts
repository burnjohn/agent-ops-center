const TICKET_RE = /^T-([1-9]\d*)$/;
const SESSION_RE = /^S-(\d{4,})$/;

export function formatTicketId(n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`Invalid ticket number: ${n}`);
  return `T-${n}`;
}

/** Returns the ticket number, or null when `id` is not `T-<n>`. */
export function parseTicketId(id: string): number | null {
  const m = TICKET_RE.exec(id);
  return m ? Number(m[1]) : null;
}

/** `S-<nnnn>`: zero-padded to four digits, longer numbers keep all digits. */
export function formatSessionId(n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`Invalid session number: ${n}`);
  return `S-${String(n).padStart(4, '0')}`;
}

/** Returns the session number, or null when `id` is not `S-<nnnn+>`. */
export function parseSessionId(id: string): number | null {
  const m = SESSION_RE.exec(id);
  return m ? Number(m[1]) : null;
}
