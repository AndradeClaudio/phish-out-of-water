import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import type { FollowInspection } from '../../application/follow-inspection.js';
import { InspectionNotFoundError } from '../../application/inspection-not-found-error.js';
import type { OpenInspection } from '../../application/open-inspection.js';
import { ForbiddenInspectionTargetError } from '../../domain/inspection.js';
import { InvalidWebAddressError } from '../../domain/web-address.js';
import { toInspectionView } from './inspection-view.js';

export interface HttpServerDependencies {
  readonly openInspection: OpenInspection;
  readonly followInspection: FollowInspection;
  readonly publicDirectory: string;
}

const SUBMISSIONS_PER_MINUTE_PER_CLIENT = 6;

export function buildHttpServer(dependencies: HttpServerDependencies): FastifyInstance {
  const server = Fastify({ logger: true, bodyLimit: 16 * 1024 });
  const allowSubmission = createSubmissionLimiter(SUBMISSIONS_PER_MINUTE_PER_CLIENT);

  server.register(fastifyStatic, { root: dependencies.publicDirectory });

  server.post<{ Body: { link?: unknown } }>('/api/inspections', async (request, reply) => {
    if (!allowSubmission(request.ip)) {
      return reply.code(429).send({ error: 'Too many links at once. Please wait a minute and try again.' });
    }
    const link = typeof request.body?.link === 'string' ? request.body.link : '';
    const id = await dependencies.openInspection.execute(link);
    return reply.code(202).send({ id: id.value });
  });

  server.get<{ Params: { id: string } }>('/api/inspections/:id', async (request) => {
    const inspection = await dependencies.followInspection.execute(request.params.id);
    return toInspectionView(inspection);
  });

  server.get<{ Params: { id: string; index: string } }>('/api/inspections/:id/screenshots/:index', async (request, reply) => {
    const inspection = await dependencies.followInspection.execute(request.params.id);
    const screenshot = inspection.evidence?.screenshots[Number(request.params.index)];
    if (screenshot === undefined) {
      return reply.code(404).send({ error: 'Screenshot not found.' });
    }
    return reply.type(screenshot.mediaType).header('Cache-Control', 'private, max-age=3600').send(Buffer.from(screenshot.base64Content, 'base64'));
  });

  server.setErrorHandler((error, request, reply) => respondToError(error, reply, () => request.log.error(error)));

  return server;
}

function respondToError(error: unknown, reply: FastifyReply, logUnexpected: () => void): FastifyReply {
  if (error instanceof InvalidWebAddressError || error instanceof ForbiddenInspectionTargetError) {
    return reply.code(400).send({ error: error.message });
  }
  if (error instanceof InspectionNotFoundError) {
    return reply.code(404).send({ error: error.message });
  }
  logUnexpected();
  return reply.code(500).send({ error: 'Something went wrong on our side. Please try again.' });
}

/** Each submission starts a real browser, so a client cannot start more than a few per minute. */
function createSubmissionLimiter(limitPerMinute: number): (clientAddress: string) => boolean {
  const recentSubmissions = new Map<string, number[]>();
  return (clientAddress) => {
    const oneMinuteAgo = Date.now() - 60_000;
    const recent = (recentSubmissions.get(clientAddress) ?? []).filter((timestamp) => timestamp > oneMinuteAgo);
    if (recent.length >= limitPerMinute) {
      recentSubmissions.set(clientAddress, recent);
      return false;
    }
    recentSubmissions.set(clientAddress, [...recent, Date.now()]);
    return true;
  };
}
