import type { Period, SessionSort } from '@agent-ops/shared';
import { formatMoney, formatMonthDay } from '../../lib/format';

export const PERIOD_OPTIONS: readonly { value: Period; label: string }[] = [
  { value: 'today', label: 'TODAY' },
  { value: '7d', label: '7 DAYS' },
  { value: '30d', label: '30 DAYS' },
  { value: 'all', label: 'ALL TIME' },
];

export const PERIOD_NAME: Record<Period, string> = {
  today: 'TODAY',
  '7d': 'LAST 7 DAYS',
  '30d': 'LAST 30 DAYS',
  all: 'ALL TIME',
};

export const SORT_NAME: Record<SessionSort, string> = {
  start: 'START TIME',
  input: 'INPUT',
  output: 'OUTPUT',
  cacheRead: 'CACHE READ',
  cacheWrite: 'CACHE WRITE',
  cost: 'COST',
};

export const BREAKDOWN_ROWS = 6;
export const NO_TICKET = 'No ticket';

export function emptyPeriodText(autoPlay: boolean): string {
  return autoPlay
    ? 'No sessions in this period yet. Pick a longer period.'
    : 'No sessions in this period yet. Pick a longer period, or press Play to let the simulated agents work.';
}

/** Axis ticks top to bottom: peak, ⅔, ⅓, $0 (UI-AC-114). */
export function costAxis(peakUsd: number): string[] {
  return [peakUsd, (peakUsd * 2) / 3, peakUsd / 3, 0].map(formatMoney);
}

/** Day label: `Today` or `Mon D`. */
export const dayLabel = (date: string, isToday: boolean): string =>
  isToday ? 'Today' : formatMonthDay(date);

/** First day, two intermediate days, `TODAY` (UI-AC-114, e.g. SEP 25 / OCT 4 / OCT 14 / TODAY). */
export function costXLabels(days: readonly { date: string }[]): { index: number; text: string }[] {
  const last = days.length - 1;
  const picks = [0, Math.floor(last / 3), Math.floor((2 * last) / 3)];
  return [
    ...picks.map((index) => ({
      index,
      text: formatMonthDay(days[index]?.date ?? '').toUpperCase(),
    })),
    { index: last, text: 'TODAY' },
  ];
}
