/**
 * Display formatters (web-ui "Display formats", AC-25, AC-138).
 * Pure: every relative value takes the Simulation Clock as an argument; nothing reads the wall clock.
 * Every time is shown in UTC, whatever the browser's zone.
 */

export type TimeInput = string | number;

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const toMs = (t: TimeInput): number => (typeof t === 'number' ? t : Date.parse(t));
const pad = (n: number): string => String(n).padStart(2, '0');

/** `hh:mm:ss` in UTC. */
export function formatClock(t: TimeInput): string {
  const d = new Date(toMs(t));
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** `hh:mm` in UTC. */
export function formatHourMinute(t: TimeInput): string {
  const d = new Date(toMs(t));
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** `Mon D` in UTC, e.g. `Oct 4`. */
export function formatMonthDay(t: TimeInput): string {
  const d = new Date(toMs(t));
  return `${MONTHS[d.getUTCMonth()] ?? ''} ${d.getUTCDate()}`;
}

const utcDayKey = (ms: number): number => Math.floor(ms / 86_400_000);

/** True when `t` falls on the UTC date of `now` (the Simulation Clock). */
export function isSameUtcDay(t: TimeInput, now: TimeInput): boolean {
  return utcDayKey(toMs(t)) === utcDayKey(toMs(now));
}

/** `Today` or `Mon D`, decided from the UTC date of the Simulation Clock. */
export function formatDay(t: TimeInput, now: TimeInput): string {
  return isSameUtcDay(t, now) ? 'Today' : formatMonthDay(t);
}

/** Table start time: `Today hh:mm` / `Mon D hh:mm`. */
export function formatStart(t: TimeInput, now: TimeInput): string {
  return `${formatDay(t, now)} ${formatHourMinute(t)}`;
}

/** `$x.xx`. */
export function formatMoney(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/** `<1 000` as is, `x.xK`, `x.xxM`. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/** Whole seconds between two instants, never negative. */
export function secondsBetween(from: TimeInput, to: TimeInput): number {
  return Math.max(0, Math.floor((toMs(to) - toMs(from)) / 1000));
}

/** Age `Ns`, `Nm`, `Nh` relative to the Simulation Clock; `upper` for cards and `SEEN` (`12S`, `4M`, `2H`). */
export function formatAge(from: TimeInput, now: TimeInput, upper = true): string {
  const sec = secondsBetween(from, now);
  let text: string;
  if (sec < 60) text = `${sec}s`;
  else if (sec < 3600) text = `${Math.floor(sec / 60)}m`;
  else text = `${Math.floor(sec / 3600)}h`;
  return upper ? text.toUpperCase() : text;
}

/** Duration `Ns` (under a minute), `Nm`, `Nh MMm`. */
export function formatDuration(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${pad(min % 60)}m`;
}

/** Tool timer `m:ss`. */
export function formatTimer(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  return `${Math.floor(sec / 60)}:${pad(sec % 60)}`;
}

/** Share as a whole percent, `0%` when the total is zero. */
export function formatPercent(part: number, total: number): string {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : '0%';
}
