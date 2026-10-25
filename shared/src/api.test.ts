import { describe, expect, it } from 'vitest';
import {
  AnswerBody,
  AS_OF_SEQ_HEADER,
  CreateTicketBody,
  EventsQuery,
  HoldBody,
  MSG_ANSWER_REQUIRED,
  MSG_COMMENT_REQUIRED,
  MSG_TITLE_REQUIRED,
  ModelPricesResponse,
  MoveTicketBody,
  RequestChangesBody,
  SessionsQuery,
  UsageQuery,
  UsageResponse,
} from './api.js';

describe('request validation', () => {
  it('rejects a whitespace-only title with the exact message at path title', () => {
    const r = CreateTicketBody.safeParse({ title: '   ' });
    expect(r.success).toBe(false);
    const issue = r.error?.issues[0];
    expect(issue?.path).toEqual(['title']);
    expect(issue?.message).toBe(MSG_TITLE_REQUIRED);
    expect(MSG_TITLE_REQUIRED).toBe('Title is required.');
  });
  it('trims a valid title', () => {
    expect(CreateTicketBody.parse({ title: '  Hi ' }).title).toBe('Hi');
  });
  it('rejects unknown fields', () => {
    expect(CreateTicketBody.safeParse({ title: 'x', extra: 1 }).success).toBe(false);
    expect(MoveTicketBody.safeParse({ to: 'done', expectedStatus: 'review', x: 1 }).success).toBe(
      false,
    );
  });
  it('enforces text limits', () => {
    expect(CreateTicketBody.safeParse({ title: 'a'.repeat(201) }).success).toBe(false);
    expect(CreateTicketBody.safeParse({ title: 'a'.repeat(200) }).success).toBe(true);
    expect(
      CreateTicketBody.safeParse({ title: 'a', description: 'a'.repeat(10_001) }).success,
    ).toBe(false);
    expect(
      CreateTicketBody.safeParse({ title: 'a', acceptanceCriteria: Array(51).fill('x') }).success,
    ).toBe(false);
    expect(
      CreateTicketBody.safeParse({ title: 'a', acceptanceCriteria: ['x'.repeat(501)] }).success,
    ).toBe(false);
    expect(AnswerBody.safeParse({ answer: 'a'.repeat(4001) }).success).toBe(false);
  });
  it('uses the spec messages for comment and answer', () => {
    expect(RequestChangesBody.safeParse({ comment: ' ' }).error?.issues[0]?.message).toBe(
      MSG_COMMENT_REQUIRED,
    );
    expect(MSG_COMMENT_REQUIRED).toBe('A comment is required — tell the agent what to change.');
    const a = AnswerBody.safeParse({ answer: '' });
    expect(a.error?.issues[0]?.message).toBe(MSG_ANSWER_REQUIRED);
    expect(a.error?.issues[0]?.path).toEqual(['answer']);
  });
  it('validates hold body', () => {
    expect(HoldBody.safeParse({ clientId: 'nope', held: true }).success).toBe(false);
    expect(HoldBody.safeParse({ clientId: crypto.randomUUID(), held: true }).success).toBe(true);
  });
});

describe('query schemas', () => {
  it('applies defaults and coerces', () => {
    expect(EventsQuery.parse({}).limit).toBe(40);
    expect(EventsQuery.parse({ limit: '200', beforeSeq: '5' })).toMatchObject({
      limit: 200,
      beforeSeq: 5,
    });
    expect(EventsQuery.safeParse({ limit: '201' }).success).toBe(false);
    expect(SessionsQuery.parse({})).toMatchObject({
      period: '30d',
      sort: 'start',
      limit: 12,
      offset: 0,
    });
    expect(SessionsQuery.safeParse({ limit: '101' }).success).toBe(false);
    expect(SessionsQuery.safeParse({ sort: 'bogus' }).success).toBe(false);
    expect(UsageQuery.parse({}).period).toBe('30d');
    expect(EventsQuery.safeParse({ nope: '1' }).success).toBe(false);
  });
});

describe('responses', () => {
  it('requires dataSource mock on cost-bearing responses', () => {
    expect(ModelPricesResponse.safeParse({ items: [], dataSource: 'mock' }).success).toBe(true);
    expect(ModelPricesResponse.safeParse({ items: [] }).success).toBe(false);
    const usage = {
      period: '30d',
      kpis: {
        totalCostUsd: 0,
        tokens: 0,
        cacheReadShare: 0,
        sessions: 0,
        runningNow: 0,
        avgCostUsd: 0,
        medianCostUsd: 0,
      },
      costPerDay: Array.from({ length: 30 }, (_, i) => ({
        date: `2026-10-${String(i + 1).padStart(2, '0')}`,
        inPeriod: true,
        isToday: false,
        costUsd: 0,
      })),
      peakUsd: 0,
      breakdowns: { byAgent: [], byTicket: [], byModel: [], byActivity: [] },
    };
    expect(UsageResponse.safeParse(usage).success).toBe(false);
    expect(UsageResponse.safeParse({ ...usage, dataSource: 'mock' }).success).toBe(true);
  });
  it('exposes the as-of header name', () => {
    expect(AS_OF_SEQ_HEADER).toBe('X-As-Of-Seq');
  });
});
