import {
  AnswerBody,
  AssignTicketBody,
  CreateTicketBody,
  MoveTicketBody,
  RequestChangesBody,
  SessionSummary,
  TicketIdParams,
  type CommandResult,
} from '@agent-ops/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { CommandOutcome } from '../../../application/services/ticket-work.js';
import type { SnapshotReader } from '../../../application/ports/index.js';
import { getAgent } from '../../../application/queries/get-agent.js';
import { getSession } from '../../../application/queries/get-session.js';
import { getTicket } from '../../../application/queries/get-ticket.js';
import { listTickets } from '../../../application/queries/list-tickets.js';
import { DomainRefusal } from '../../../domain/errors.js';
import { setAsOfSeq } from '../as-of-seq.js';
import { parseOr400 } from '../validate.js';

/** Ticket command use cases, already bound to their deps by the composition root. */
export interface TicketCommands {
  create(body: CreateTicketBody): Promise<CommandOutcome>;
  move(id: string, body: MoveTicketBody): Promise<CommandOutcome>;
  assign(id: string, body: AssignTicketBody): Promise<CommandOutcome>;
  requestChanges(id: string, body: RequestChangesBody): Promise<CommandOutcome>;
  answer(id: string, body: AnswerBody): Promise<CommandOutcome>;
}

export interface TicketRoutesDeps {
  snapshots: SnapshotReader;
  commands: TicketCommands;
}

const SUMMARY_KEYS = Object.keys(SessionSummary.shape) as (keyof SessionSummary)[];

/** Maps domain state to the shared `CommandResult`; agent / session DTOs come from read queries. */
async function toCommandResult(
  snapshots: SnapshotReader,
  outcome: CommandOutcome,
): Promise<CommandResult> {
  const result: CommandResult = { seq: outcome.seq };
  if (outcome.ticket) result.ticket = outcome.ticket;
  if (outcome.agent) {
    const { data } = await getAgent(snapshots, outcome.agent.id);
    if (data) result.agent = data;
  }
  if (outcome.session) {
    const { data } = await getSession(snapshots, outcome.session.id);
    if (data) {
      const summary: Record<string, unknown> = {};
      for (const key of SUMMARY_KEYS) summary[key] = data[key];
      result.session = summary as SessionSummary;
    }
  }
  return result;
}

/** `/api/tickets` reads and the five operator commands (API-AC-7..24). */
export function ticketRoutes(deps: TicketRoutesDeps): FastifyPluginAsync {
  const { snapshots, commands } = deps;
  return async (app) => {
    app.get('/tickets', async (_request, reply) => {
      const { data, asOfSeq } = await listTickets(snapshots);
      return setAsOfSeq(reply, asOfSeq).send(data);
    });

    app.get('/tickets/:id', async (request, reply) => {
      const { id } = parseOr400(TicketIdParams, request.params);
      const { data, asOfSeq } = await getTicket(snapshots, id);
      if (data === null) throw new DomainRefusal('not_found', `Ticket ${id} not found.`);
      return setAsOfSeq(reply, asOfSeq).send(data);
    });

    app.post('/tickets', async (request, reply) => {
      const body = parseOr400(CreateTicketBody, request.body);
      const outcome = await commands.create(body);
      return reply.code(201).send(await toCommandResult(snapshots, outcome));
    });

    app.post('/tickets/:id/move', async (request) => {
      const { id } = parseOr400(TicketIdParams, request.params);
      const body = parseOr400(MoveTicketBody, request.body);
      return toCommandResult(snapshots, await commands.move(id, body));
    });

    app.post('/tickets/:id/assign', async (request) => {
      const { id } = parseOr400(TicketIdParams, request.params);
      const body = parseOr400(AssignTicketBody, request.body);
      return toCommandResult(snapshots, await commands.assign(id, body));
    });

    app.post('/tickets/:id/request-changes', async (request) => {
      const { id } = parseOr400(TicketIdParams, request.params);
      const body = parseOr400(RequestChangesBody, request.body);
      return toCommandResult(snapshots, await commands.requestChanges(id, body));
    });

    app.post('/tickets/:id/answer', async (request) => {
      const { id } = parseOr400(TicketIdParams, request.params);
      const body = parseOr400(AnswerBody, request.body);
      return toCommandResult(snapshots, await commands.answer(id, body));
    });
  };
}
