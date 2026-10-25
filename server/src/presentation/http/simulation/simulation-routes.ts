import {
  AgentStepBody,
  AgentStepParams,
  EmptyBody,
  HoldBody,
  type AgentStepResult,
  type HoldResponse,
  type StepResult,
} from '@agent-ops/shared';
import type { FastifyPluginAsync } from 'fastify';
import { getSimulationState } from '../../../application/queries/get-simulation-state.js';
import type { SnapshotReader } from '../../../application/ports/index.js';
import type { PlayControl } from '../../../application/simulation/play-control.js';
import { runToNextStage } from '../../../application/simulation/run-to-next-stage.js';
import { stepAgent, type StepAgentInput } from '../../../application/simulation/step-agent.js';
import type { StepAllMode } from '../../../application/simulation/step-all.js';
import { setAsOfSeq } from '../as-of-seq.js';
import { parseOr400 } from '../validate.js';

/** Use-case entry points the routes call; the container binds `StepDeps` / `stepAll` deps into them. */
export interface SimulationRouteDeps {
  snapshots: SnapshotReader;
  playControl: PlayControl;
  stepAgent: (input: StepAgentInput) => ReturnType<typeof stepAgent>;
  runToNextStage: (input: StepAgentInput) => ReturnType<typeof runToNextStage>;
  /** Operator header Step (mode `step_all`); refuses with `simulation_playing` while Play is on. */
  stepAll: (mode: StepAllMode) => Promise<{ seq: number; steps: 1 }>;
}

/**
 * Simulation routes (API-AC-44..46, AC-54..56). Steps happen only on POST (ADR-0008); `hold` writes no event.
 * `GET /simulation` carries `X-As-Of-Seq`.
 */
export function simulationRoutes(deps: SimulationRouteDeps): FastifyPluginAsync {
  return async (app) => {
    app.get('/simulation', async (_request, reply) => {
      const { data, asOfSeq } = await getSimulationState(deps.snapshots, {
        playing: deps.playControl.isPlaying(),
        held: deps.playControl.hasActiveHold(),
      });
      return setAsOfSeq(reply, asOfSeq).send(data);
    });

    app.post('/simulation/play', async (request) => {
      parseOr400(EmptyBody, request.body ?? {});
      return deps.playControl.play();
    });

    app.post('/simulation/pause', async (request) => {
      parseOr400(EmptyBody, request.body ?? {});
      return deps.playControl.pause();
    });

    app.post('/simulation/step', async (request): Promise<StepResult> => {
      parseOr400(EmptyBody, request.body ?? {});
      return deps.stepAll('step_all');
    });

    app.post('/simulation/hold', async (request): Promise<HoldResponse> => {
      const body = parseOr400(HoldBody, request.body);
      const hold = deps.playControl.setHold(body.clientId, body.held);
      return {
        held: hold.held,
        expiresAt: hold.expiresAtMs === null ? null : new Date(hold.expiresAtMs).toISOString(),
      };
    });

    app.post('/simulation/agents/:agentId/step', async (request): Promise<AgentStepResult> => {
      const { agentId } = parseOr400(AgentStepParams, request.params);
      const body = parseOr400(AgentStepBody, request.body);
      const input: StepAgentInput = { agentId, ticketId: body.ticketId };
      if (body.mode === 'step') {
        const out = await deps.stepAgent(input);
        return { seq: out.seq, steps: 1, stoppedBecause: 'single' };
      }
      const out = await deps.runToNextStage(input);
      return { seq: out.seq, steps: out.steps, stoppedBecause: out.stopReason };
    });
  };
}
