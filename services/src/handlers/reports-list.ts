import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import type { ListReportsResponse } from '@derf/shared';
import { logger } from '../lib/logger';
import { parseBoundingBox } from '../lib/bbox';
import { queryReports } from '../lib/reports-query';
import { fail, ok } from '../lib/response';

/**
 * GET /reports?bbox=... via API Gateway — public: reading resource status must
 * not require login.
 *
 * The query itself lives in `lib/reports-query`, shared with the Application
 * Load Balancer ingress so both paths return identical data.
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const requestId = event.requestContext.requestId;
  const bbox = parseBoundingBox(event.queryStringParameters?.bbox);

  if (!bbox) {
    logger.warn('invalid bbox', { requestId, bbox: event.queryStringParameters?.bbox });
    return fail(
      400,
      'INVALID_BBOX',
      'Query parameter "bbox" must be minLon,minLat,maxLon,maxLat within valid ranges',
      requestId,
    );
  }

  const { reports, truncated, cellsQueried } = await queryReports(bbox);

  logger.info('list reports', {
    requestId,
    ingress: 'apigateway',
    cells: cellsQueried,
    returned: reports.length,
    truncated,
  });

  const body: ListReportsResponse = {
    reports,
    // Only present when true, so a complete result stays a clean payload.
    ...(truncated ? { truncated: true } : {}),
  };
  return ok(body);
};
