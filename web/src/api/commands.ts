import { useMutation } from '@tanstack/react-query';
import {
  AgentStepResult,
  CommandResult,
  HoldResponse,
  StepResult,
  type AgentStepBody,
  type AnswerBody,
  type AssignTicketBody,
  type CreateTicketBody,
  type HoldBody,
  type MoveTicketBody,
  type RequestChangesBody,
} from '@agent-ops/shared';
import { post } from './client';

/**
 * Commands never touch the cache optimistically (U-16): the UI updates from the stream events and
 * refetches. Each hook exposes TanStack's `isPending` for the in-flight state (UI-AC-22).
 */
const seg = encodeURIComponent;
const empty = {};

export const usePlay = () =>
  useMutation({
    mutationFn: async () => (await post('/simulation/play', CommandResult, empty)).data,
  });
export const usePause = () =>
  useMutation({
    mutationFn: async () => (await post('/simulation/pause', CommandResult, empty)).data,
  });
export const useStepAll = () =>
  useMutation({ mutationFn: async () => (await post('/simulation/step', StepResult, empty)).data });
export const useHold = () =>
  useMutation({
    mutationFn: async (body: HoldBody) => (await post('/simulation/hold', HoldResponse, body)).data,
  });
export const useStepAgent = () =>
  useMutation({
    mutationFn: async ({ agentId, ...body }: AgentStepBody & { agentId: string }) =>
      (await post(`/simulation/agents/${seg(agentId)}/step`, AgentStepResult, body)).data,
  });

export const useCreateTicket = () =>
  useMutation({
    mutationFn: async (body: CreateTicketBody) =>
      (await post('/tickets', CommandResult, body)).data,
  });
export const useMoveTicket = () =>
  useMutation({
    mutationFn: async ({ id, ...body }: MoveTicketBody & { id: string }) =>
      (await post(`/tickets/${seg(id)}/move`, CommandResult, body)).data,
  });
export const useAssignTicket = () =>
  useMutation({
    mutationFn: async ({ id, ...body }: AssignTicketBody & { id: string }) =>
      (await post(`/tickets/${seg(id)}/assign`, CommandResult, body)).data,
  });
export const useRequestChanges = () =>
  useMutation({
    mutationFn: async ({ id, ...body }: RequestChangesBody & { id: string }) =>
      (await post(`/tickets/${seg(id)}/request-changes`, CommandResult, body)).data,
  });
export const useAnswerTicket = () =>
  useMutation({
    mutationFn: async ({ id, ...body }: AnswerBody & { id: string }) =>
      (await post(`/tickets/${seg(id)}/answer`, CommandResult, body)).data,
  });
