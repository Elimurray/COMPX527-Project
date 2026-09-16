import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  cellsForBoundingBox,
  type BoundingBox,
  type ListReportsResponse,
  type Report,
  type ReportItem,
} from '@derf/shared';
import { ddb, requireEnv } from '../lib/clients';
import { logger } from '../lib/logger';
import { fail, ok } from '../lib/response';

const TABLE = requireEnv('REPORTS_TABLE');

/** Most recent rows to read per geohash cell. */
const PER_CELL_LIMIT = 50;

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

/** Strips the storage-only key attributes before the report leaves the API. */
function toReport(item: ReportItem): Report {
  const { reportedAtId: _sk, expiresAt: _ttl, ...report } = item;
  return report;
}

function within(bbox: BoundingBox, report: Report): boolean {
  const { lat, lon } = report.location;
  return (
    lat >= bbox.minLat && lat <= bbox.maxLat && lon >= bbox.minLon && lon <= bbox.maxLon
  );
}

/**
 * GET /reports?bbox=... — public: reading resource status must not require login.
 *
 * The viewport is converted to the geohash cells it covers, and each cell is a
 * bounded Query on the partition key. There is no Scan anywhere in this path,
 * so cost and latency track the size of the viewport rather than the size of
 * the table.
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

  const { cells, truncated } = cellsForBoundingBox(bbox);

  const responses = await Promise.all(
    cells.map((cell) =>
      ddb.send(
        new QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: 'geohash = :cell',
          ExpressionAttributeValues: { ':cell': cell },
          // Newest first: the sort key starts with an ISO timestamp.
          ScanIndexForward: false,
          Limit: PER_CELL_LIMIT,
        }),
      ),
    ),
  );

  // A geohash cell is a rectangle that overhangs the requested viewport, so rows
  // near the edge can fall outside it. Filter to the actual box before replying.
  const reports = responses
    .flatMap((response) => (response.Items ?? []) as ReportItem[])
    .map(toReport)
    .filter((report) => within(bbox, report))
    .sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));

  logger.info('list reports', {
    requestId,
    cells: cells.length,
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
