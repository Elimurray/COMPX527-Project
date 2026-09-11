import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { ApiError } from '@derf/shared';

const JSON_HEADERS = { 'content-type': 'application/json' };

/** A successful JSON response. */
export function ok<T>(body: T, statusCode = 200): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  };
}

/**
 * An error response in the single shape every endpoint uses.
 *
 * `requestId` is always included: it is what lets a user-reported failure be
 * traced to its CloudWatch log entry without guessing.
 */
export function fail(
  statusCode: number,
  code: string,
  message: string,
  requestId?: string,
): APIGatewayProxyStructuredResultV2 {
  const body: ApiError = { error: { code, message, requestId } };
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  };
}
