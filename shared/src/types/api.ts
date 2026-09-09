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
