/** Route table of SPEC-web-ui and the labels derived from it. Pure, no React. */

export type NavSection = 'board' | 'mission-control' | 'usage';

export const BOARD_PATH = '/board';
export const MISSION_CONTROL_PATH = '/mission-control';
export const USAGE_PATH = '/usage';

export const ticketPath = (id: string) => `/tickets/${encodeURIComponent(id)}`;
export const agentPath = (id: string) => `/agents/${encodeURIComponent(id)}`;
export const sessionPath = (id: string) => `/sessions/${encodeURIComponent(id)}`;

function segments(pathname: string): string[] {
  return pathname.split('/').filter(Boolean);
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/** Nav item that owns a route; detail pages belong to a primary item (UI-AC-2). */
export function navSection(pathname: string): NavSection | null {
  const [first, second] = segments(pathname);
  switch (first) {
    case 'board':
      return second === undefined ? 'board' : null;
    case 'tickets':
      return second === undefined ? null : 'board';
    case 'mission-control':
      return second === undefined ? 'mission-control' : null;
    case 'agents':
    case 'sessions':
      return second === undefined ? null : 'mission-control';
    case 'usage':
      return second === undefined ? 'usage' : null;
    default:
      return null;
  }
}

/** `← BACK TO <label>`: screen name, or the id of a ticket, agent or session (UI-AC-10). */
export function screenLabel(pathname: string): string {
  const [first, second] = segments(pathname);
  if ((first === 'tickets' || first === 'agents' || first === 'sessions') && second !== undefined) {
    return decode(second);
  }
  if (first === 'mission-control') return 'MISSION CONTROL';
  if (first === 'usage') return 'USAGE & COST';
  return 'BOARD';
}
