/** Deployment stages. Stack and resource names are prefixed with these. */
export const STAGES = ['dev', 'prod'] as const;
export type Stage = (typeof STAGES)[number];

/**
 * Geohash precision used to bucket reports for "nearby" queries.
 * Precision 5 is roughly a 5km x 5km cell — a sensible neighbourhood-sized
 * bucket for shelters and supply points. Revisit alongside the DynamoDB key
 * schema decision (see PROGRESS.md, open decisions).
 */
export const GEOHASH_PRECISION = 5;

/** How long a report is treated as current before the UI marks it stale. */
export const REPORT_FRESHNESS_MINUTES = 120;
