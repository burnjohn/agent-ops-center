import { act } from '@testing-library/react';
import {
  Event as AppEvent,
  HelloMessage,
  KeepaliveMessage,
  ResyncMessage,
  STREAM_EVENT_HELLO,
  STREAM_EVENT_KEEPALIVE,
  STREAM_EVENT_RESYNC,
} from '@agent-ops/shared';
import type { z } from 'zod';

type Listener = (e: MessageEvent) => void;

/**
 * In-memory `EventSource` for `/api/stream`. Install with `FakeEventSource.install()`, drive with the
 * static `emit*` helpers (all payloads are validated against the shared stream schemas and dispatched
 * inside `act`). `FakeEventSource.instances` records every connection, so `?since=` can be asserted.
 */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  private static original: typeof EventSource | undefined;

  readonly url: string;
  readyState = 0; // CONNECTING
  onerror: ((e: Event) => void) | null = null;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(url: string | URL) {
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.readyState = 2; // CLOSED
  }

  get closed(): boolean {
    return this.readyState === 2;
  }

  /** Delivers a raw SSE frame to this connection (no-op once closed). */
  dispatch(type: string, data: unknown): void {
    if (this.closed) return;
    this.readyState = 1;
    const message = new MessageEvent(type, {
      data: typeof data === 'string' ? data : JSON.stringify(data),
    });
    act(() => {
      for (const l of this.listeners.get(type) ?? []) l(message);
    });
  }

  /** Simulates a connection error: fires `onerror` (the app then closes the source). */
  error(): void {
    act(() => {
      this.onerror?.(new window.Event('error'));
    });
  }

  // ---- lifecycle -----------------------------------------------------------------------------

  static install(): void {
    FakeEventSource.original = globalThis.EventSource;
    FakeEventSource.instances = [];
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  }

  static uninstall(): void {
    FakeEventSource.instances = [];
    if (FakeEventSource.original) globalThis.EventSource = FakeEventSource.original;
    else Reflect.deleteProperty(globalThis, 'EventSource');
    FakeEventSource.original = undefined;
  }

  /** The most recent connection (the live one unless the app has reconnected). */
  static get current(): FakeEventSource {
    const last = FakeEventSource.instances.at(-1);
    if (!last) throw new Error('No EventSource was opened — did the app mount?');
    return last;
  }

  // ---- server -> client messages -------------------------------------------------------------

  static emitHello(msg: Partial<z.input<typeof HelloMessage>> = {}): void {
    FakeEventSource.current.dispatch(
      STREAM_EVENT_HELLO,
      HelloMessage.parse({
        lastSeq: 44,
        journalFloorSeq: 0,
        clock: '2026-10-24T14:32:00Z',
        playing: false,
        ...msg,
      }),
    );
  }

  static emitEvent(event: AppEvent): void {
    FakeEventSource.current.dispatch(event.type, AppEvent.parse(event));
  }

  static emitResync(msg: Partial<z.input<typeof ResyncMessage>> = {}): void {
    FakeEventSource.current.dispatch(
      STREAM_EVENT_RESYNC,
      ResyncMessage.parse({ reason: 'below_floor', lastSeq: 44, journalFloorSeq: 0, ...msg }),
    );
  }

  static emitKeepalive(): void {
    FakeEventSource.current.dispatch(STREAM_EVENT_KEEPALIVE, KeepaliveMessage.parse({}));
  }

  /** Connection error on the current source. */
  static fail(): void {
    FakeEventSource.current.error();
  }
}
