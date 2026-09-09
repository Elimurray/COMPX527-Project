import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import type { HealthResponse } from '@derf/shared';
import { logger } from '../lib/logger';

/**
 * GET /health — unauthenticated liveness probe.
 *
 * Deliberately trivial: it exists so the Cognito → API Gateway → Lambda path can
 * be proven end to end in M3 before any real logic sits on top of it.
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  logger.info('health check', { requestId: event.requestContext.requestId });

  const body: HealthResponse = {
    status: 'ok',
    stage: process.env.DERF_STAGE ?? 'dev',
    version: process.env.SERVICE_VERSION ?? '0.1.0',
  };

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
};
