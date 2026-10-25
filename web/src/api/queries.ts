import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  AgentListResponse,
  AgentPageResponse,
  EventsPageResponse,
  ModelPricesResponse,
  OverviewResponse,
  SessionDetail,
  SessionsPageResponse,
  SimulationState,
  TicketDetailResponse,
  TicketListResponse,
  UsageResponse,
  type EventsQuery,
  type SessionsQuery,
  type UsageQuery,
} from '@agent-ops/shared';
import type { z } from 'zod';
import { get, type QueryParams, type Snapshot } from './client';
import { keys } from './keys';

/**
 * Every query stores a `Snapshot` ({ data, asOfSeq }) so the stream layer can skip events the snapshot
 * already includes (UI-AC-24). Hooks expose `data` directly through `select`.
 */
const selectData = <T>(s: Snapshot<T>): T => s.data;

function useRead<S extends z.ZodType>(
  key: readonly unknown[],
  path: string,
  schema: S,
  params?: QueryParams,
  keepPrevious = false,
) {
  return useQuery({
    ...(keepPrevious && { placeholderData: keepPreviousData }),
    queryKey: key,
    queryFn: ({ signal }) => get(path, schema, params, signal),
    select: selectData<z.output<S>>,
  });
}

export const useSimulation = () => useRead(keys.simulation(), '/simulation', SimulationState);
export const useTickets = () => useRead(keys.tickets(), '/tickets', TicketListResponse);
export const useTicket = (id: string) =>
  useRead(keys.ticket(id), `/tickets/${encodeURIComponent(id)}`, TicketDetailResponse);
export const useAgents = () => useRead(keys.agents(), '/agents', AgentListResponse);
export const useAgent = (id: string) =>
  useRead(keys.agent(id), `/agents/${encodeURIComponent(id)}`, AgentPageResponse);
export const useOverview = () => useRead(keys.overview(), '/overview', OverviewResponse);
export const useSession = (id: string) =>
  useRead(keys.session(id), `/sessions/${encodeURIComponent(id)}`, SessionDetail);
export const useUsage = (params: Partial<UsageQuery> = {}) =>
  useRead(keys.usage(params), '/usage', UsageResponse, params, true);
export const useSessions = (params: Partial<SessionsQuery> = {}) =>
  useRead(keys.sessions(params), '/sessions', SessionsPageResponse, params, true);
export const useModelPrices = () =>
  useRead(keys.modelPrices(), '/model-prices', ModelPricesResponse);

/** Event feed: newest page first, older pages via `beforeSeq` (`nextBeforeSeq` is the cursor). */
export function useEventsFeed(filters: Partial<Omit<EventsQuery, 'beforeSeq'>> = {}) {
  return useInfiniteQuery({
    queryKey: keys.events(filters),
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam, signal }) =>
      get('/events', EventsPageResponse, { ...filters, beforeSeq: pageParam }, signal),
    getNextPageParam: (last) => last.data.nextBeforeSeq ?? undefined,
  });
}
