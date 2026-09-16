import type { ALBEvent, ALBHandler, ALBResult } from 'aws-lambda';
import type { ApiError, HealthResponse, ListReportsResponse } from '@derf/shared';
import { logger } from '../lib/logger';
import { parseBoundingBox } from '../lib/bbox';
import { queryReports } from '../lib/reports-query';

/**
 * Application Load Balancer ingress for the public read path.
 *
 * This is a second, independent way into the same data as the API Gateway route,
 * and it exists so the two can be compared directly — identical logic, different
 * ingress. The query itself is shared via `lib/reports-query`, so neither path
 * can drift from the other.
 *
 * Two differences from the API Gateway handler are forced by ALB, not chosen:
 *
 *  1. The event and response shapes differ. ALB supplies `path`, `httpMethod`
 *     and flat `queryStringParameters`, and expects `statusDescription` in the
 *     response. An API Gateway v2 handler pointed at an ALB target group would
 *     fail on the first property it read.
 *
 *  2. ALB does **not** URL-decode query string values, unlike API Gateway. The
 *     bbox arrives percent-encoded and must be decoded here, or every request
 *     would be rejected as malformed.
 */

const JSON_HEADERS = { 'content-type': 'application/json' };

function respond(statusCode: number, description: string, body: unknown): ALBResult {
  return {
    statusCode,
    statusDescription: `${statusCode} ${description}`,
    headers: JSON_HEADERS,
    isBase64Encoded: false,
    body: JSON.stringify(body),
  };
}

function errorBody(code: string, message: string, requestId: string): ApiError {
  return { error: { code, message, requestId } };
}

/** ALB passes query values still percent-encoded; API Gateway does not. */
function decodeParam(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    // A malformed escape sequence is a bad request, not a crash.
    return undefined;
  }
}

export const handler: ALBHandler = async (event: ALBEvent): Promise<ALBResult> => {
  // ALB has no requestId of its own, so correlate on the trace header instead.
  const requestId = event.headers?.['x-amzn-trace-id'] ?? 'alb-unknown';
  const path = event.path;

  if (event.httpMethod !== 'GET') {
    return respond(
      405,
      'Method Not Allowed',
      errorBody('METHOD_NOT_ALLOWED', 'This ingress serves GET requests only', requestId),
    );
  }

  if (path === '/health') {
    const body: HealthResponse = {
      status: 'ok',
      stage: process.env.DERF_STAGE ?? 'dev',
      version: process.env.SERVICE_VERSION ?? '0.1.0',
    };
    return respond(200, 'OK', body);
  }

  if (path === '/reports') {
    const bbox = parseBoundingBox(decodeParam(event.queryStringParameters?.bbox));

    if (!bbox) {
      logger.warn('invalid bbox', { requestId, ingress: 'alb' });
      return respond(
        400,
        'Bad Request',
        errorBody(
          'INVALID_BBOX',
          'Query parameter "bbox" must be minLon,minLat,maxLon,maxLat within valid ranges',
          requestId,
        ),
      );
    }

    const { reports, truncated, cellsQueried, resolution } = await queryReports(bbox);

    logger.info('list reports', {
      requestId,
      ingress: 'alb',
      cells: cellsQueried,
      resolution,
      returned: reports.length,
      truncated,
    });

    const body: ListReportsResponse = {
      reports,
      ...(truncated ? { truncated: true } : {}),
    };
    return respond(200, 'OK', body);
  }

  return respond(
    404,
    'Not Found',
    errorBody('NOT_FOUND', `No route for ${path}`, requestId),
  );
};
