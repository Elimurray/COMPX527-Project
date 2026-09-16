import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  cellsForBoundingBox,
  type BoundingBox,
  type Report,
  type ReportItem,
} from '@derf/shared';
import { withinBoundingBox } from './bbox';
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

/** Strips the storage-only key attributes before a report leaves the API. */
function toReport(item: ReportItem): Report {
  const { reportedAtId: _sk, expiresAt: _ttl, ...report } = item;
  return report;
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
    .filter((report) => withinBoundingBox(bbox, report.location))
    .sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));

  return { reports, truncated, cellsQueried: cells.length };
}
