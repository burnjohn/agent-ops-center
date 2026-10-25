import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { KEEPALIVE_INTERVAL_MS, TicketListResponse } from '@agent-ops/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEventSource } from '../test/FakeEventSource';
import { createFakeNetwork, jsonResponse, type FakeNetwork } from '../test/fakeNetwork';
import { buildEvent, seedTickets } from '../test/fixtures';
import type { Snapshot } from './client';
import { keys } from './keys';
import { RETRY_MS, WATCHDOG_MS, startEventStream, useConnection } from './stream';

const ticketMoved = (seq: number) =>
  buildEvent(
    seq,
    'ticket.moved',
    { summary: 's', from: 'backlog', to: 'ready' },
    { ticketId: 'T-1' },
  );

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('event stream', () => {
  let qc: QueryClient;
  let net: FakeNetwork;
  let stop: () => void = () => undefined;

  const conn = renderHookConnection();

  function renderHookConnection() {
    return () => renderHook(() => useConnection()).result;
  }

  const start = () => {
    stop = startEventStream(qc);
    return conn();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.install();
    net = createFakeNetwork().install();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    qc.setQueryData<Snapshot<unknown>>(keys.tickets(), { data: [], asOfSeq: 0 });
  });
  afterEach(() => {
    stop();
    stop = () => undefined;
    qc.clear();
    net.uninstall();
  });

  it('watchdog is twice the server keepalive interval', () => {
    // Contract (Q1): 30 s without any message means lost; server keepalive is 15 s.
    expect(WATCHDOG_MS).toBe(KEEPALIVE_INTERVAL_MS * 2);
    expect(WATCHDOG_MS).toBe(30_000);
  });

  it('opens one stream without ?since= and is connected only after hello (UI-AC-29)', () => {
    const result = start();

    // Contract: before hello the tab is still connecting, and the first request has no resume cursor.
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.current.url).toBe('/api/stream');
    expect(result.current.status).toBe('connecting');

    FakeEventSource.emitHello({ lastSeq: 44 });

    // Contract: hello on first connect makes the connection live at the journal head.
    expect(result.current.status).toBe('connected');
    expect(result.current.lastAppliedSeq).toBe(44);
  });

  it('marks the connection lost after 30 s of silence, not before', () => {
    const result = start();
    FakeEventSource.emitHello({ lastSeq: 44 });

    advance(WATCHDOG_MS - 1);
    // Contract: just under the watchdog the connection is still considered live.
    expect(result.current.status).toBe('connected');

    advance(1);
    // Contract: 30 s with no message at all marks the connection lost.
    expect(result.current.status).toBe('lost');
    expect(FakeEventSource.current.closed).toBe(true);
  });

  it('treats keepalive as a message: it re-arms the 30 s watchdog', () => {
    const result = start();
    FakeEventSource.emitHello({ lastSeq: 44 });

    advance(25_000);
    FakeEventSource.emitKeepalive();
    advance(25_000);
    // Contract: 50 s since hello but only 25 s since the keepalive, so still connected.
    expect(result.current.status).toBe('connected');

    advance(5_000);
    // Contract: 30 s after the last keepalive the connection is lost.
    expect(result.current.status).toBe('lost');
  });

  it('marks lost on a connection error and reconnects with ?since=<lastAppliedSeq>', () => {
    const result = start();
    FakeEventSource.emitHello({ lastSeq: 44 });
    FakeEventSource.emitEvent(ticketMoved(45));
    expect(result.current.lastAppliedSeq).toBe(45);

    FakeEventSource.fail();
    // Contract: an error is surfaced immediately (banner within 2 s, UI-AC-29).
    expect(result.current.status).toBe('lost');
    expect(FakeEventSource.current.closed).toBe(true);

    advance(RETRY_MS);
    // Contract: the retry resumes from the last applied seq, not from scratch.
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.current.url).toBe('/api/stream?since=45');
  });

  it('stays lost after reconnecting until replay reaches hello.lastSeq, then connected', () => {
    const result = start();
    FakeEventSource.emitHello({ lastSeq: 44 });
    FakeEventSource.fail();
    advance(RETRY_MS);

    FakeEventSource.emitHello({ lastSeq: 46 });
    // Contract: hello alone is not enough; events 45..46 are still missing.
    expect(result.current.status).not.toBe('connected');

    FakeEventSource.emitEvent(ticketMoved(45));
    expect(result.current.status).not.toBe('connected');

    FakeEventSource.emitEvent(ticketMoved(46));
    // Contract: connected only once lastAppliedSeq >= hello.lastSeq.
    expect(result.current.status).toBe('connected');
    expect(result.current.lastAppliedSeq).toBe(46);
  });

  it('is connected right away when the reconnect hello reports nothing new', () => {
    const result = start();
    FakeEventSource.emitHello({ lastSeq: 44 });
    FakeEventSource.fail();
    advance(RETRY_MS);

    FakeEventSource.emitHello({ lastSeq: 44 });

    // Contract: nothing to replay means the connection is live.
    expect(result.current.status).toBe('connected');
  });

  it('manual reconnect() resumes with ?since= and ignores the closed source', () => {
    const result = start();
    FakeEventSource.emitHello({ lastSeq: 44 });
    const first = FakeEventSource.current;
    FakeEventSource.fail();

    act(() => result.current.reconnect());

    // Contract: the retry button reconnects immediately, with the resume cursor.
    expect(FakeEventSource.current).not.toBe(first);
    expect(FakeEventSource.current.url).toBe('/api/stream?since=44');
  });

  it('drops events with seq <= lastAppliedSeq and applies newer ones (UI-AC-24)', () => {
    const result = start();
    FakeEventSource.emitHello({ lastSeq: 44 });
    // A fresh tickets snapshot at the journal head; only newer events may invalidate it.
    qc.setQueryData<Snapshot<unknown>>(keys.tickets(), { data: [], asOfSeq: 44 });
    const invalidated = () => qc.getQueryState(keys.tickets())?.isInvalidated === true;

    FakeEventSource.emitEvent(ticketMoved(44));
    FakeEventSource.emitEvent(ticketMoved(30));
    // Contract: duplicates / older events are ignored: no cache effect and the cursor does not move.
    expect(invalidated()).toBe(false);
    expect(result.current.lastAppliedSeq).toBe(44);

    FakeEventSource.emitEvent(ticketMoved(45));
    // Contract: a newer event is applied (invalidates the stale read) and advances the cursor.
    expect(invalidated()).toBe(true);
    expect(result.current.lastAppliedSeq).toBe(45);
  });

  it('first hello invalidates reads that predate hello.lastSeq', () => {
    start();

    FakeEventSource.emitHello({ lastSeq: 44 });

    // Contract: reads made before the stream opened (asOfSeq 0 < 44) may be stale and are refreshed.
    expect(qc.getQueryState(keys.tickets())?.isInvalidated).toBe(true);
  });

  it('resync refetches active queries, drops inactive ones and resets the cursor (UI-AC-32)', async () => {
    net.on('GET', '/tickets', jsonResponse(TicketListResponse, seedTickets(), { asOfSeq: 60 }));
    const result = start();
    FakeEventSource.emitHello({ lastSeq: 44 });
    qc.setQueryData(keys.agents(), { data: [], asOfSeq: 44 });
    let fetches = 0;
    const observer = new QueryObserver(qc, {
      queryKey: keys.tickets(),
      queryFn: () => {
        fetches += 1;
        return { data: seedTickets(), asOfSeq: 60 };
      },
    });
    const unsubscribe = observer.subscribe(() => undefined);
    const before = fetches;

    FakeEventSource.emitResync({ lastSeq: 60, reason: 'too_far_behind' });

    try {
      // Contract: on-screen data is refetched; unobserved cache entries are discarded.
      expect(fetches).toBeGreaterThan(before);
      expect(qc.getQueryData(keys.agents())).toBeUndefined();
      // Contract: the cursor jumps to the server's head and the connection is live.
      expect(result.current.lastAppliedSeq).toBe(60);
      expect(result.current.status).toBe('connected');
    } finally {
      unsubscribe();
    }
  });

  it('ignores malformed messages without moving the cursor', () => {
    const result = start();
    FakeEventSource.emitHello({ lastSeq: 44 });

    FakeEventSource.current.dispatch('ticket.moved', '{not json');
    FakeEventSource.current.dispatch('ticket.moved', { seq: 'x' });

    // Contract: garbage frames never corrupt the applied-seq cursor.
    expect(result.current.lastAppliedSeq).toBe(44);
  });

  it('ignores messages from a source that was replaced by a reconnect', () => {
    const result = start();
    FakeEventSource.emitHello({ lastSeq: 44 });
    const stale = FakeEventSource.current;
    act(() => result.current.reconnect());
    FakeEventSource.emitHello({ lastSeq: 44 });

    // Contract: only the live source may advance state. (A closed source drops frames itself, so
    // re-open its flag to prove the app-level guard too.)
    stale.readyState = 1;
    stale.dispatch('ticket.moved', ticketMoved(45));

    expect(result.current.lastAppliedSeq).toBe(44);
  });

  it('stop closes the stream and cancels the watchdog and retry timers', () => {
    start();
    FakeEventSource.emitHello({ lastSeq: 44 });
    FakeEventSource.fail();

    stop();
    advance(RETRY_MS * 5);

    // Contract: after teardown nothing reconnects.
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
