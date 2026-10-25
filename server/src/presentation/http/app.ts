import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import { notFoundEnvelope, registerErrorHandling } from './errors.js';

export const BODY_LIMIT_BYTES = 65536;

export interface AppDeps {
  /** Route plugins registered under the `/api` prefix (healthz, tickets, stream, ...). */
  routes: readonly FastifyPluginAsync[];
  /** Built web bundle; defaults to the repo's `web/dist`. Served only when the folder exists. */
  staticRoot?: string;
  logger?: boolean;
}

const DEFAULT_STATIC_ROOT = fileURLToPath(new URL('../../../../web/dist', import.meta.url));

/** Builds the Fastify instance: JSON API under `/api`, optional static web bundle with SPA fallback. No CORS (same origin). */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: BODY_LIMIT_BYTES, logger: deps.logger ?? false });
  registerErrorHandling(app);

  const staticRoot = deps.staticRoot ?? DEFAULT_STATIC_ROOT;
  const serveStatic = existsSync(staticRoot);
  if (serveStatic) await app.register(fastifyStatic, { root: staticRoot });

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    const isApi = path === '/api' || path.startsWith('/api/');
    if (serveStatic && request.method === 'GET' && !isApi) return reply.sendFile('index.html');
    return reply.code(404).send(notFoundEnvelope(request));
  });

  for (const route of deps.routes) await app.register(route, { prefix: '/api' });
  return app;
}
