import { ErrorResponse, CreateTicketBody } from '@agent-ops/shared';
import { describe, expect, it } from 'vitest';
import { DbUnavailableError, type SnapshotReader } from '../../application/ports/index.js';
import { DomainRefusal } from '../../domain/errors.js';
import { buildApp } from './app.js';
import { parseOr400 } from './validate.js';
import { setAsOfSeq } from './as-of-seq.js';
import { healthzRoutes } from './routes/healthz.js';

const up: SnapshotReader = { read: async (fn) => ({ data: await fn({} as never), asOfSeq: 7 }) };
const down: SnapshotReader = {
  read: () => Promise.reject(new DbUnavailableError()),
};

describe('presentation core', () => {
  it('healthz up/down', async () => {
    const a = await buildApp({ routes: [healthzRoutes(up)], staticRoot: '/nonexistent' });
    const r = await a.inject({ method: 'GET', url: '/api/healthz' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, db: 'up' });
    const b = await buildApp({ routes: [healthzRoutes(down)], staticRoot: '/nonexistent' });
    const r2 = await b.inject({ method: 'GET', url: '/api/healthz' });
    expect(r2.statusCode).toBe(503);
    expect(r2.json()).toEqual({ ok: false, db: 'down' });
  });

  it('maps errors to the envelope without leaking internals', async () => {
    const app = await buildApp({
      staticRoot: '/nonexistent',
      routes: [
        async (f) => {
          f.get('/refuse', async () => {
            throw new DomainRefusal('transition_refused', 'nope', { reason: 'why' });
          });
          f.get('/missing', async () => {
            throw new DomainRefusal('not_found', 'Ticket T-999 not found');
          });
          f.get('/db', async () => {
            throw new DbUnavailableError();
          });
          f.get('/boom', async () => {
            throw new Error('select * from secret');
          });
          f.post('/bad', async (req) => parseOr400(CreateTicketBody, req.body));
          f.get('/seq', async (_req, reply) => setAsOfSeq(reply, 42).send({}));
        },
      ],
    });
    const get = async (url: string) => app.inject({ method: 'GET', url });
    const refuse = await get('/api/refuse');
    expect(refuse.statusCode).toBe(409);
    expect(ErrorResponse.parse(refuse.json()).error).toMatchObject({
      code: 'transition_refused',
      reason: 'why',
    });
    expect((await get('/api/missing')).statusCode).toBe(404);
    expect((await get('/api/db')).json()).toMatchObject({ error: { code: 'db_unavailable' } });
    const boom = await get('/api/boom');
    expect(boom.statusCode).toBe(500);
    expect(boom.body).not.toContain('secret');
    expect((await get('/api/nope')).statusCode).toBe(404);
    expect((await get('/api/seq')).headers['x-as-of-seq']).toBe('42');
    const bad = await app.inject({ method: 'POST', url: '/api/bad', payload: { extra: 1 } });
    expect(bad.statusCode).toBe(400);
    expect(ErrorResponse.parse(bad.json()).error.details?.length).toBeGreaterThan(0);
    const big = await app.inject({
      method: 'POST',
      url: '/api/bad',
      payload: { title: 'x'.repeat(70000) },
    });
    expect(big.statusCode).toBe(400);
  });
});
