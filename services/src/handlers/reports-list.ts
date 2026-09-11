import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import type { BoundingBox, ListReportsResponse, Report } from '@derf/shared';
import { logger } from '../lib/logger';
import { fail, ok } from '../lib/response';

/**
 * Parses `?bbox=minLon,minLat,maxLon,maxLat`.
 *
 * Returns null on anything malformed rather than throwing, so the handler can
 * answer 400 with a useful message.
 */
function parseBoundingBox(raw: string | undefined): BoundingBox | null {
  if (!raw) return null;

  const parts = raw.split(',').map((value) => Number(value.trim()));
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const [minLon, minLat, maxLon, maxLat] = parts as [number, number, number, number];
  if (minLon > maxLon || minLat > maxLat) return null;
  if (Math.abs(minLat) > 90 || Math.abs(maxLat) > 90) return null;
  if (Math.abs(minLon) > 180 || Math.abs(maxLon) > 180) return null;

  return { minLon, minLat, maxLon, maxLat };
}

/**
 * Fixture data, so the frontend can build against a real response shape before
 * the DynamoDB query exists.
 *
 * TODO(M5): replace with a geohash-bucketed Query over the reports table.
 */
function fixtureReports(bbox: BoundingBox): Report[] {
  const centreLat = (bbox.minLat + bbox.maxLat) / 2;
  const centreLon = (bbox.minLon + bbox.maxLon) / 2;
  const now = new Date().toISOString();

  return [
    {
      reportId: '00000000-0000-4000-8000-000000000001',
      resourceType: 'shelter',
      status: 'limited',
      location: { lat: centreLat, lon: centreLon },
      geohash: 'fixture',
      note: 'Fixture data — replaced by a real query in M5.',
      capacity: { current: 84, maximum: 100 },
      reportedBy: 'fixture-user',
      reportedAt: now,
    },
    {
      reportId: '00000000-0000-4000-8000-000000000002',
      resourceType: 'water',
      status: 'available',
      location: { lat: centreLat + 0.01, lon: centreLon + 0.01 },
      geohash: 'fixture',
      note: 'Fixture data — replaced by a real query in M5.',
      reportedBy: 'fixture-user',
      reportedAt: now,
    },
  ];
}

/** GET /reports?bbox=... — public: reading resource status must not require login. */
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

  logger.info('list reports', { requestId, bbox });

  const body: ListReportsResponse = { reports: fixtureReports(bbox) };
  return ok(body);
};
