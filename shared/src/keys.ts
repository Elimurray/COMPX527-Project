import type { Report } from './types/report';

/** Separator between the timestamp and the id inside the reports sort key. */
const SORT_KEY_SEPARATOR = '#';

/**
 * Builds the DynamoDB sort key for a report: `<ISO timestamp>#<reportId>`.
 *
 * ISO-8601 sorts lexicographically, so time-range queries behave exactly as they
 * would against a bare timestamp. The appended id makes the key unique, so two
 * reports filed in the same geohash cell in the same millisecond cannot
 * overwrite one another — which is a real risk during exactly the surge this
 * system is built for.
 */
export function reportSortKey(reportedAt: string, reportId: string): string {
  return `${reportedAt}${SORT_KEY_SEPARATOR}${reportId}`;
}

/** Splits a sort key back into its parts. */
export function parseReportSortKey(sortKey: string): {
  reportedAt: string;
  reportId: string;
} {
  const index = sortKey.indexOf(SORT_KEY_SEPARATOR);
  if (index === -1) {
    throw new Error(`Malformed report sort key: "${sortKey}"`);
  }
  return {
    reportedAt: sortKey.slice(0, index),
    reportId: sortKey.slice(index + 1),
  };
}

/**
 * A report as stored in DynamoDB.
 *
 * Differs from the API-facing `Report` by the key attributes: `reportedAtId` is
 * the composite sort key, and `expiresAt` drives the table's TTL. Neither is
 * returned to clients — map storage to `Report` at the API boundary.
 */
export interface ReportItem extends Report {
  /** Sort key. Build with `reportSortKey()`. */
  reportedAtId: string;
  /**
   * Coarse geohash prefix, the partition key of the wide-area index.
   *
   * Geohash is a prefix code, so this is simply the first
   * COARSE_GEOHASH_PRECISION characters of `geohash` — stored as its own
   * attribute because DynamoDB cannot index a prefix of another attribute.
   */
  geohash3: string;
  /** TTL attribute — Unix epoch **seconds**, not milliseconds. */
  expiresAt: number;
}
