import { randomUUID } from 'node:crypto';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from 'aws-lambda';
import {
  RESOURCE_STATUS,
  RESOURCE_TYPES,
  type CreateReportInput,
  type CreateReportResponse,
  type ResourceStatus,
  type ResourceType,
} from '@derf/shared';
import { requireEnv, sqs } from '../lib/clients';
import { logger } from '../lib/logger';
import { fail, ok } from '../lib/response';

const QUEUE_URL = requireEnv('REPORTS_QUEUE_URL');

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

  const capacity = candidate.capacity as
    { current?: unknown; maximum?: unknown } | undefined;
  if (capacity !== undefined) {
    const { current, maximum } = capacity;
    if (typeof current !== 'number' || typeof maximum !== 'number') {
      return { error: 'capacity must be { current: number, maximum: number }' };
    }
    if (current < 0 || maximum <= 0 || current > maximum) {
      return { error: 'capacity.current must be between 0 and capacity.maximum' };
    }
  }

  return {
    input: {
      resourceType: resourceType as ResourceType,
      status: status as ResourceStatus,
      location: { lat, lon },
      ...(typeof note === 'string' ? { note } : {}),
      ...(capacity
        ? {
            capacity: {
              current: Number(capacity.current),
              maximum: Number(capacity.maximum),
            },
          }
        : {}),
    },
  };
}

/**
 * POST /reports — validate, enqueue, return 202.
 *
 * The 202 is the contract: the client is told the report was *accepted*, not
 * that it is stored. Handing off to SQS here is what lets a surge queue up
 * instead of overwhelming DynamoDB — the API stays responsive under load
 * because it does almost no work.
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

  // The id is minted here, before the queue, so the write downstream can be made
  // idempotent against at-least-once delivery.
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify({
        reportId,
        reportedBy: String(userId),
        reportedAt: new Date().toISOString(),
        input: result.input,
      }),
    }),
  );

  logger.info('report queued', {
    requestId,
    userId: String(userId),
    reportId,
    resourceType: result.input.resourceType,
  });

  const body: CreateReportResponse = { reportId, status: 'accepted' };
  return ok(body, 202);
};
