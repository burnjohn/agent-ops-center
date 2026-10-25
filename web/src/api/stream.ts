import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  Event,
  EVENT_TYPES,
  HelloMessage,
  KEEPALIVE_INTERVAL_MS,
  KeepaliveMessage,
  ResyncMessage,
  STREAM_EVENT_HELLO,
  STREAM_EVENT_KEEPALIVE,
  STREAM_EVENT_RESYNC,
} from '@agent-ops/shared';
import { buildPath } from './client';
import { applyEvent, applyHello, applyResync, invalidateStale } from './eventCache';

/** The only module besides client.ts allowed to create an EventSource (ADR-0011). One per tab. */

export type ConnectionStatus = 'connecting' | 'connected' | 'lost';

/** No message (incl. keepalive) for twice the server interval = lost (UI-AC-29). */
export const WATCHDOG_MS = KEEPALIVE_INTERVAL_MS * 2;
/** Delay before a manual reconnect while lost. */
export const RETRY_MS = 2_000;

export interface Connection {
  status: ConnectionStatus;
  /** Highest seq applied to the cache; null before the first `hello`. */
  lastAppliedSeq: number | null;
}

let state: Connection = { status: 'connecting', lastAppliedSeq: null };
const listeners = new Set<() => void>();

function set(patch: Partial<Connection>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useConnection(): Connection & { reconnect: () => void } {
  const conn = useSyncExternalStore(subscribe, () => state);
  return { ...conn, reconnect };
}

let source: EventSource | null = null;
let client: QueryClient | null = null;
/** The connection watchdog: the only timer in this module (SPEC-web-ui Non-functional). */
let timer: ReturnType<typeof setTimeout> | null = null;
/** Set by `hello`; `connected` waits until replay reaches it. */
let helloLastSeq: number | null = null;

function armTimer(ms: number, fn: () => void): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(fn, ms);
}

function clearTimer(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function markLost(): void {
  source?.close();
  source = null;
  set({ status: 'lost' });
  armTimer(RETRY_MS, reconnect);
}

function touch(): void {
  armTimer(WATCHDOG_MS, markLost);
}

function parse<T>(
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
  raw: unknown,
): T | null {
  if (typeof raw !== 'string') return null;
  try {
    const r = schema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

function maybeConnected(): void {
  const { lastAppliedSeq, status } = state;
  if (
    status !== 'connected' &&
    helloLastSeq !== null &&
    lastAppliedSeq !== null &&
    lastAppliedSeq >= helloLastSeq
  ) {
    set({ status: 'connected' });
  }
}

function connect(qc: QueryClient): void {
  source?.close();
  helloLastSeq = null;
  const since = state.lastAppliedSeq;
  // Manual reconnect resumes with `?since=`; the native auto-reconnect (Last-Event-ID) is never used
  // because we close the source on every error.
  const es = new EventSource(buildPath('/stream', since === null ? undefined : { since }));
  source = es;
  touch();

  es.addEventListener(STREAM_EVENT_HELLO, (m) => {
    if (source !== es) return;
    touch();
    const hello = parse(HelloMessage, (m as MessageEvent).data);
    if (!hello) return;
    helloLastSeq = hello.lastSeq;
    applyHello(qc, hello);
    if (state.lastAppliedSeq === null) {
      // First connect: reads made before the stream opened may predate `hello.lastSeq`.
      invalidateStale(qc, hello.lastSeq);
      set({ lastAppliedSeq: hello.lastSeq });
    }
    maybeConnected();
  });

  es.addEventListener(STREAM_EVENT_KEEPALIVE, (m) => {
    if (source !== es) return;
    parse(KeepaliveMessage, (m as MessageEvent).data);
    touch();
  });

  es.addEventListener(STREAM_EVENT_RESYNC, (m) => {
    if (source !== es) return;
    touch();
    const resync = parse(ResyncMessage, (m as MessageEvent).data);
    if (!resync) return;
    applyResync(qc);
    set({ lastAppliedSeq: resync.lastSeq });
    helloLastSeq = resync.lastSeq;
    maybeConnected();
  });

  for (const type of EVENT_TYPES) {
    es.addEventListener(type, (m) => {
      if (source !== es) return;
      touch();
      const event = parse(Event, (m as MessageEvent).data);
      if (!event) return;
      const last = state.lastAppliedSeq;
      if (last !== null && event.seq <= last) return; // duplicate (UI-AC-24)
      applyEvent(qc, event);
      set({ lastAppliedSeq: event.seq });
      maybeConnected();
    });
  }

  es.onerror = () => {
    if (source === es) markLost();
  };
}

export function reconnect(): void {
  if (client) connect(client);
}

/** Opens the tab's single stream. Returns a stop function. Idempotent per client. */
export function startEventStream(qc: QueryClient): () => void {
  client = qc;
  state = { status: 'connecting', lastAppliedSeq: null };
  connect(qc);
  return () => {
    source?.close();
    source = null;
    client = null;
    clearTimer();
  };
}

/** Mount once near the app root. */
export function useEventStream(): void {
  const qc = useQueryClient();
  useEffect(() => startEventStream(qc), [qc]);
}
