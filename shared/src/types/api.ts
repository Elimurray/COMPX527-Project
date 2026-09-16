import type { Report } from './report';

/** Bounding box for map viewport queries: GET /reports?bbox=minLon,minLat,maxLon,maxLat */
export interface BoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface ListReportsResponse {
  reports: Report[];
  /** Opaque pagination token; absent when there are no further pages. */
  nextToken?: string;
  /**
   * True when the requested area needed more geohash cells than the server will
   * query, so `reports` covers only part of it.
   *
   * Clients must surface this. Showing a truncated result as if it were complete
   * tells someone there are no resources near them when there may be plenty —
   * the most dangerous way this system could be wrong.
   */
  truncated?: boolean;
}

/** POST /reports returns 202 — the report is queued, not yet written. */
export interface CreateReportResponse {
  reportId: string;
  status: 'accepted';
}

export interface HealthResponse {
  status: 'ok';
  stage: string;
  version: string;
}

/** Every non-2xx response from the API uses this shape. */
export interface ApiError {
  error: {
    code: string;
    message: string;
    /** Correlates a client-reported failure with its CloudWatch log entry. */
    requestId?: string;
  };
}
