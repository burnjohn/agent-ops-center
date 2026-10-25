import { describe, expect, it } from 'vitest';
import { HelloMessage, KeepaliveMessage, ResyncMessage, STREAM_EVENT_KEEPALIVE } from './stream.js';

describe('stream messages', () => {
  it('parses hello', () => {
    const m = { lastSeq: 5, journalFloorSeq: 1, clock: '2026-10-24T14:32:00Z', playing: false };
    expect(HelloMessage.parse(m)).toEqual(m);
  });
  it('accepts the three resync reasons only', () => {
    for (const reason of ['ahead', 'below_floor', 'too_far_behind'])
      expect(ResyncMessage.safeParse({ reason, lastSeq: 1, journalFloorSeq: 0 }).success).toBe(
        true,
      );
    expect(
      ResyncMessage.safeParse({ reason: 'other', lastSeq: 1, journalFloorSeq: 0 }).success,
    ).toBe(false);
  });
  it('keepalive is an empty object on the keepalive event name', () => {
    expect(STREAM_EVENT_KEEPALIVE).toBe('keepalive');
    expect(KeepaliveMessage.safeParse({}).success).toBe(true);
    expect(KeepaliveMessage.safeParse({ a: 1 }).success).toBe(false);
  });
});
