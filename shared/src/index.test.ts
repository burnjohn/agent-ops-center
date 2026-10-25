import { describe, expect, it } from 'vitest';
import {
  AgentPageResponse,
  ModelPricesResponse,
  SessionsPageResponse,
  TicketDetailResponse,
  UsageResponse,
  deriveHealth,
  entryCostUsd,
  needsInputReason,
  operatorTransition,
  sumTokens,
  tokenActivityOf,
} from './index.js';

describe('barrel', () => {
  it('exposes the rule functions', () => {
    for (const fn of [
      deriveHealth,
      entryCostUsd,
      sumTokens,
      operatorTransition,
      needsInputReason,
      tokenActivityOf,
    ]) {
      expect(typeof fn).toBe('function');
    }
  });

  it('every response carrying dataSource requires the literal "mock"', () => {
    for (const schema of [
      TicketDetailResponse,
      AgentPageResponse,
      SessionsPageResponse,
      UsageResponse,
      ModelPricesResponse,
    ]) {
      const ds = schema.shape.dataSource;
      expect(ds.safeParse('mock').success).toBe(true);
      expect(ds.safeParse('real').success).toBe(false);
    }
  });

  it('parses minimal samples of dataSource responses', () => {
    expect(ModelPricesResponse.safeParse({ items: [], dataSource: 'mock' }).success).toBe(true);
    expect(ModelPricesResponse.safeParse({ items: [] }).success).toBe(false);
    const page = { items: [], total: 0, limit: 12, offset: 0, sort: 'start', dataSource: 'mock' };
    expect(SessionsPageResponse.safeParse(page).success).toBe(true);
    expect(SessionsPageResponse.safeParse({ ...page, dataSource: 'live' }).success).toBe(false);
  });
});
