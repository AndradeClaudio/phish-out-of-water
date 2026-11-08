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
/** Caddy on the same machine is the only proxy we trust to tell us the client's real IP. */
const TRUSTED_PROXY = '127.0.0.1';

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/** Screenshots are pictures of hostile pages: even if one were not really an image, it must never run as a page. */
const SCREENSHOT_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "sandbox; default-src 'none'",
  'Content-Disposition': 'inline; filename="screenshot"',
  'Cache-Control': 'private, max-age=3600',
};

export function buildHttpServer(dependencies: HttpServerDependencies): FastifyInstance {
  const server = Fastify({ logger: true, bodyLimit: 16 * 1024, trustProxy: TRUSTED_PROXY });
  const allowSubmission = createSubmissionLimiter(SUBMISSIONS_PER_MINUTE_PER_CLIENT);

  server.addHook('onRequest', async (_request, reply) => {
    reply.headers(SECURITY_HEADERS);
  });
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
    return reply.type(screenshot.mediaType).headers(SCREENSHOT_HEADERS).send(Buffer.from(screenshot.base64Content, 'base64'));
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
