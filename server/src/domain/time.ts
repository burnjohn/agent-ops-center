/** ISO timestamp `seconds` later (may be negative). Output is always `YYYY-MM-DDTHH:mm:ss.sssZ`. */
export function addSeconds(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString();
}

/** UTC calendar date `YYYY-MM-DD` of an ISO timestamp (API-AC-35). */
export function utcDay(iso: string): string {
  return new Date(Date.parse(iso)).toISOString().slice(0, 10);
}
