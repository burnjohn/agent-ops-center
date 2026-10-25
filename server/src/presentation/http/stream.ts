import type { FastifyPluginAsync } from 'fastify';
import {
  type Event,
  type HelloMessage,
  KEEPALIVE_INTERVAL_MS,
  type ResyncMessage,
  STREAM_EVENT_HELLO,
  STREAM_EVENT_KEEPALIVE,
  STREAM_EVENT_RESYNC,
} from '@agent-ops/shared';
import type { EventJournal, EventSubscriber, Scheduler } from '../../application/ports/index.js';

/** Resume further behind than this gets a `resync` instead of a replay (API-AC-61). */
export const MAX_REPLAY_BEHIND = 5000;
const REPLAY_PAGE_SIZE = 500;

export interface StreamDeps {
  journal: EventJournal;
  subscriber: EventSubscriber;
  scheduler: Scheduler;
  /** Simulation clock and Play flag for the `hello` message. */
  hello: () => Promise<Pick<HelloMessage, 'clock' | 'playing'>>;
}

/** Non-negative integer or `undefined` (anything else counts as absent). */
export function parseSeq(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || !/^\d{1,15}$/.test(raw)) return undefined;
  return Number(raw);
}

function frame(event: string, data: unknown, id?: number): string {
  return `${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** `GET /api/stream` (§C8, API-AC-58…62): hello, resume without gap or duplicate, resync, keepalive. */
export function streamRoutes(deps: StreamDeps): FastifyPluginAsync {
  return async (app) => {
    app.get('/stream', async (request, reply) => {
      const query = request.query as { since?: unknown };
      const header = request.headers['last-event-id'];
      const resumeFrom =
        parseSeq(Array.isArray(header) ? header[0] : header) ?? parseSeq(query.since);

      const raw = reply.raw;
      reply.hijack();
      raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      raw.flushHeaders();

      let closed = false;
      let lastSent = 0;
      let live = false;
      const buffer: Event[] = [];
      const write = (chunk: string): void => {
        if (!closed && !raw.destroyed) raw.write(chunk);
      };
      const send = (event: Event): void => {
        if (event.seq <= lastSent) return;
        lastSent = event.seq;
        write(frame(event.type, event, event.seq));
      };

      // 1. subscribe and buffer first, so commits during replay are not lost.
      const unsubscribe = deps.subscriber.subscribe((events) => {
        if (live) for (const e of events) send(e);
        else buffer.push(...events);
      });
      const cancelKeepalive = deps.scheduler.every(KEEPALIVE_INTERVAL_MS, () => {
        write(': keepalive\n\n');
        write(frame(STREAM_EVENT_KEEPALIVE, {}));
      });
      const cleanup = (): void => {
        closed = true;
        unsubscribe();
        cancelKeepalive();
      };
      raw.on('close', cleanup);

      try {
        const [lastSeq, floor, state] = await Promise.all([
          deps.journal.lastSeq(),
          deps.journal.floor(),
          deps.hello(),
        ]);
        write(
          frame(STREAM_EVENT_HELLO, {
            lastSeq,
            journalFloorSeq: floor,
            ...state,
          } satisfies HelloMessage),
        );

        let reason: ResyncMessage['reason'] | undefined;
        if (resumeFrom !== undefined) {
          if (resumeFrom > lastSeq) reason = 'ahead';
          else if (resumeFrom < floor) reason = 'below_floor';
          else if (lastSeq - resumeFrom > MAX_REPLAY_BEHIND) reason = 'too_far_behind';
        }

        if (reason !== undefined) {
          write(
            frame(STREAM_EVENT_RESYNC, {
              reason,
              lastSeq,
              journalFloorSeq: floor,
            } satisfies ResyncMessage),
          );
        }

        if (resumeFrom === undefined || reason !== undefined) {
          lastSent = lastSeq;
        } else {
          lastSent = resumeFrom;
          for (;;) {
            if (closed) return reply;
            const page = await deps.journal.since(lastSent, REPLAY_PAGE_SIZE);
            if (page.length === 0) break;
            for (const e of page) send(e);
          }
        }

        // 3. drain the buffer (dedup by seq) and go live; no await between drain and flip.
        for (const e of buffer.splice(0)) send(e);
        live = true;
      } catch (error) {
        request.log.error({ err: error }, 'stream setup failed');
        cleanup();
        raw.end();
      }
      return reply;
    });
  };
}
