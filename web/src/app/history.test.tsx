import { describe, expect, it } from 'vitest';
import {
  HISTORY_LIMIT,
  historyReducer,
  initialHistory,
  type HistoryAction,
  type HistoryState,
} from './history';
import { screenLabel } from './routeInfo';

const run = (start: string, actions: HistoryAction[]): HistoryState =>
  actions.reduce(historyReducer, initialHistory(start));

const visit = (pathname: string): HistoryAction => ({ type: 'location', pathname });

describe('visit history reducer (UI-AC-4, AC-11, AC-12)', () => {
  it('records each new location and keeps at most the 30 most recent visits, dropping the oldest', () => {
    const visits = Array.from({ length: 31 }, (_, i) => `/tickets/T-${i + 1}`);
    const state = run('/board', visits.map(visit));

    // Contract: 32 pages were visited (Board + 31 tickets); only the 30 latest earlier ones remain.
    expect(HISTORY_LIMIT).toBe(30);
    expect(state.stack).toHaveLength(30);
    expect(state.stack[0]).toBe('/tickets/T-1'); // '/board' (the oldest) was dropped
    expect(state.stack.at(-1)).toBe('/tickets/T-30');
    expect(state.current).toBe('/tickets/T-31');
  });

  it('does not add a visit when the target equals the current route', () => {
    const state = run('/board', [
      visit('/tickets/T-1'),
      visit('/tickets/T-1'),
      visit('/tickets/T-1'),
    ]);
    // Contract: re-visiting the page you are on adds nothing.
    expect(state.stack).toEqual(['/board']);
  });

  it('Back removes the entry it opens and does not record the arrival as a new visit', () => {
    const state = run('/board', [
      visit('/tickets/T-12'),
      visit('/agents/alpha'),
      { type: 'back', target: '/tickets/T-12' },
      visit('/tickets/T-12'),
    ]);
    // Contract: after Back from alpha to T-12 the history is [board] (alpha is not pushed).
    expect(state.stack).toEqual(['/board']);
    expect(state.current).toBe('/tickets/T-12');
  });

  it('clearing forgets every earlier visit and the arrival at the target is not recorded', () => {
    const state = run('/board', [
      visit('/tickets/T-12'),
      visit('/agents/alpha'),
      { type: 'clear', target: '/mission-control' },
      visit('/mission-control'),
    ]);
    // Contract: a primary-nav click empties the history.
    expect(state.stack).toEqual([]);
    expect(state.current).toBe('/mission-control');
  });

  it('labels previous screens by name, or by the entity id for detail pages (UI-AC-10)', () => {
    expect(screenLabel('/board')).toBe('BOARD');
    expect(screenLabel('/mission-control')).toBe('MISSION CONTROL');
    expect(screenLabel('/usage')).toBe('USAGE & COST');
    expect(screenLabel('/tickets/T-12')).toBe('T-12');
    expect(screenLabel('/agents/alpha')).toBe('alpha');
    expect(screenLabel('/sessions/S-0412')).toBe('S-0412');
  });
});
