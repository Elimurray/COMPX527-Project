import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from 'aws-lambda';
import {
  RESOURCE_STATUS,
  RESOURCE_TYPES,
  type CreateReportInput,
  type CreateReportResponse,
  type ResourceStatus,
  type ResourceType,
} from '@derf/shared';
import { logger } from '../lib/logger';
import { fail, ok } from '../lib/response';

/** Narrow unknown JSON to a valid report submission. */
function validate(body: unknown): { input: CreateReportInput } | { error: string } {
  if (typeof body !== 'object' || body === null) {
    return { error: 'Body must be a JSON object' };
  }
  const candidate = body as Record<string, unknown>;

  const resourceType = candidate.resourceType;
  if (!RESOURCE_TYPES.includes(resourceType as ResourceType)) {
    return { error: `resourceType must be one of: ${RESOURCE_TYPES.join(', ')}` };
  }

  const status = candidate.status;
  if (!RESOURCE_STATUS.includes(status as ResourceStatus)) {
    return { error: `status must be one of: ${RESOURCE_STATUS.join(', ')}` };
  }

  const location = candidate.location as { lat?: unknown; lon?: unknown } | undefined;
  const lat = location?.lat;
  const lon = location?.lon;
  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return { error: 'location must be { lat: number, lon: number }' };
  }
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return { error: 'location is outside valid latitude/longitude ranges' };
  }

  const note = candidate.note;
  if (note !== undefined && (typeof note !== 'string' || note.length > 500)) {
    return { error: 'note must be a string of at most 500 characters' };
  }

  return {
    input: {
      resourceType: resourceType as ResourceType,
      status: status as ResourceStatus,
      location: { lat, lon },
      ...(typeof note === 'string' ? { note } : {}),
    },
  };
}

/**
 * POST /reports — requires authentication.
 *
 * Validates and accepts, returning 202. It does not yet write anything.
 *
 * TODO(M5): enqueue to SQS here and let the processing Lambda do the DynamoDB
 * write. The 202 contract is deliberate — the client is told the report is
 * accepted, not that it is stored, which is what lets the queue absorb a surge.
 */
export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  const requestId = event.requestContext.requestId;
  const userId = event.requestContext.authorizer?.jwt?.claims?.sub;

  if (!userId) {
    logger.error('authorised route reached with no JWT claims', { requestId });
    return fail(500, 'MISSING_CLAIMS', 'Authoriser did not supply claims', requestId);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(event.body ?? '');
  } catch {
    return fail(400, 'INVALID_JSON', 'Body must be valid JSON', requestId);
  }

  const result = validate(parsed);
  if ('error' in result) {
    logger.warn('rejected report', { requestId, reason: result.error });
    return fail(400, 'INVALID_REPORT', result.error, requestId);
  }

  const reportId = randomUUID();
  logger.info('report accepted', {
    requestId,
    userId: String(userId),
    reportId,
    resourceType: result.input.resourceType,
  });

  const body: CreateReportResponse = { reportId, status: 'accepted' };
  return ok(body, 202);
};
