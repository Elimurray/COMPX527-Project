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

/**
 * How long a report row survives before DynamoDB's TTL removes it.
 *
 * Longer than REPORT_FRESHNESS_MINUTES on purpose: a stale report still carries
 * useful history for a while after the UI stops treating it as current. Expiry
 * keeps storage bounded without a cleanup job.
 */
export const REPORT_TTL_DAYS = 7;

/**
 * A report at or above this fraction of capacity triggers a notification —
 * "the shelter you are heading to is nearly full" is worth interrupting someone for.
 */
export const CAPACITY_ALERT_THRESHOLD = 0.9;

/**
 * Geohash precision for the NOAA station layer — deliberately coarser than
 * GEOHASH_PRECISION.
 *
 * Resolution should match the density and the query scale of the layer, not be
 * uniform across the system. Community reports are dense and read at
 * neighbourhood zoom, so ~5km cells suit them. Weather stations are sparse —
 * fifteen across all of New Zealand — and are read at country zoom, where a 5km
 * grid would need thousands of cells and exceed the query ceiling, returning
 * nothing. At ~156km cells, a nationwide viewport resolves to about 30 cells and
 * a city viewport to one.
 */
export const STATION_GEOHASH_PRECISION = 3;
