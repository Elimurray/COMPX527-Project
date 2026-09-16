import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  cellsForBoundingBox,
  type BoundingBox,
  type Report,
  type ReportItem,
} from '@derf/shared';
import { ddb, requireEnv } from './clients';

/**
 * Shared read logic for the reports collection.
 *
 * Lives here rather than in a handler because two different ingresses serve it:
 * the API Gateway HTTP API and the Application Load Balancer. Their event and
 * response shapes differ, but the query behaviour must not.
 */

const TABLE = requireEnv('REPORTS_TABLE');

/** Most recent rows to read per geohash cell. */
const PER_CELL_LIMIT = 50;

/**
 * Parses `minLon,minLat,maxLon,maxLat`.
 *
 * Returns null on anything malformed rather than throwing, so callers can answer
 * 400 with a useful message.
 */
export function parseBoundingBox(raw: string | undefined): BoundingBox | null {
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

/** Strips the storage-only key attributes before a report leaves the API. */
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

export interface QueryResult {
  reports: Report[];
  /** True when the viewport needed more cells than the server will query. */
  truncated: boolean;
  /** How many geohash cells were queried — useful in logs and in the demo. */
  cellsQueried: number;
}

/**
 * Reads every report inside a bounding box.
 *
 * The viewport is converted to the geohash cells covering it, and each cell is a
 * bounded Query on the partition key. There is no Scan in this path, so cost and
 * latency track the size of the viewport rather than the size of the table.
 */
export async function queryReports(bbox: BoundingBox): Promise<QueryResult> {
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

  return { reports, truncated, cellsQueried: cells.length };
}
