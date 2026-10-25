import { SimulationState, TicketListResponse } from '@agent-ops/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createFakeNetwork,
  errorResponse,
  jsonResponse,
  type FakeNetwork,
} from '../test/fakeNetwork';
import { SEED_LAST_SEQ, buildSimulation, seedTickets } from '../test/fixtures';
import { ApiError, NetworkError, buildPath, get, post } from './client';

describe('api client', () => {
  let net: FakeNetwork;
  beforeEach(() => {
    net = createFakeNetwork().install();
  });
  afterEach(() => {
    net.uninstall();
  });

  it('builds /api paths and drops undefined query params', () => {
    // Contract: undefined params are omitted; others are serialised.
    expect(buildPath('/events', { limit: 10, kind: undefined, warn: true })).toBe(
      '/api/events?limit=10&warn=true',
    );
    expect(buildPath('/tickets')).toBe('/api/tickets');
  });

  it('returns parsed data together with X-As-Of-Seq as asOfSeq', async () => {
    net.on('GET', '/simulation', jsonResponse(SimulationState, buildSimulation(), { asOfSeq: 77 }));

    const snap = await get('/simulation', SimulationState);

    // Contract: the snapshot carries the server's journal position so the stream can dedupe.
    expect(snap.asOfSeq).toBe(77);
    expect(snap.data.playing).toBe(false);
  });

  it('reports asOfSeq null when the header is absent or malformed', async () => {
    net.on(
      'GET',
      '/tickets',
      jsonResponse(TicketListResponse, seedTickets(), { asOfSeq: undefined }),
    );
    // Contract: no header means "unknown position", never 0.
    expect((await get('/tickets', TicketListResponse)).asOfSeq).toBeNull();

    net.on('GET', '/tickets', {
      status: 200,
      body: seedTickets(),
      asOfSeq: -3,
    });
    expect((await get('/tickets', TicketListResponse)).asOfSeq).toBeNull();
  });

  it('keeps asOfSeq 0 (an empty journal is a valid position)', async () => {
    net.on('GET', '/simulation', jsonResponse(SimulationState, buildSimulation(), { asOfSeq: 0 }));
    // Contract: 0 is a real position, distinct from "absent".
    expect((await get('/simulation', SimulationState)).asOfSeq).toBe(0);
  });

  it('sends query params and a JSON body, and records them', async () => {
    net.on('POST', '/simulation/step', jsonResponse(SimulationState, buildSimulation(), {}));

    await post('/simulation/step', SimulationState, { mode: 'step' });
    await get('/tickets', TicketListResponse, { q: 'a b' });

    // Contract: POST bodies are JSON; params are URL-encoded.
    expect(net.calls('POST', '/simulation/step')[0]?.body).toEqual({ mode: 'step' });
    expect(net.calls('GET', '/tickets')[0]?.query.get('q')).toBe('a b');
  });

  it('turns an error envelope into ApiError with code, reason and details', async () => {
    net.on(
      'GET',
      '/tickets',
      errorResponse(422, 'validation_failed', 'Bad input.', {
        reason: 'because',
        details: [{ path: 'title', message: 'Required' }],
      }),
    );

    const error = await get('/tickets', TicketListResponse).catch((e: unknown) => e);

    // Contract: the typed envelope survives the client untouched (status, code, message, details).
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 422,
      code: 'validation_failed',
      message: 'Bad input.',
      reason: 'because',
      details: [{ path: 'title', message: 'Required' }],
    });
  });

  it('maps a non-envelope error body to ApiError code "unknown"', async () => {
    net.on('GET', '/tickets', { status: 500, body: { oops: true } });

    const error = await get('/tickets', TicketListResponse).catch((e: unknown) => e);

    // Contract: an unreadable error never leaks as a raw exception; callers still get status + code.
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 500, code: 'unknown' });
  });

  it('maps a 2xx body that breaks the contract to ApiError "unknown"', async () => {
    net.on('GET', '/tickets', { status: 200, body: [{ id: 'nope' }] });

    // Contract: responses are validated against the shared schema at the boundary.
    await expect(get('/tickets', TicketListResponse)).rejects.toMatchObject({
      name: 'ApiError',
      code: 'unknown',
    });
  });

  it('throws NetworkError (with cause) when fetch rejects', async () => {
    net.networkFailure('GET', '/tickets');

    const error = await get('/tickets', TicketListResponse).catch((e: unknown) => e);

    // Contract: a dropped connection is a NetworkError, distinguishable from an ApiError.
    expect(error).toBeInstanceOf(NetworkError);
    expect(error).not.toBeInstanceOf(ApiError);
    expect((error as NetworkError).cause).toBeInstanceOf(TypeError);
  });

  it('rethrows the abort error untouched when the caller aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const error = await get('/tickets', TicketListResponse, undefined, controller.signal).catch(
      (e: unknown) => e,
    );

    // Contract: cancellation is not a network failure, so it must not raise a "cannot reach server" toast.
    expect(error).not.toBeInstanceOf(NetworkError);
    expect((error as DOMException).name).toBe('AbortError');
  });

  it('throws NetworkError when a 2xx body is not JSON', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('<html>', { status: 200 }));

    // Contract: an unreadable success body is treated as a transport problem.
    await expect(get('/tickets', z.unknown())).rejects.toBeInstanceOf(NetworkError);
    spy.mockRestore();
  });

  it('uses the seed journal head as default asOfSeq from the fake network', async () => {
    // Contract: GET /simulation from the default fake reports the seed head.
    expect((await get('/simulation', SimulationState)).asOfSeq).toBe(SEED_LAST_SEQ);
  });
});
