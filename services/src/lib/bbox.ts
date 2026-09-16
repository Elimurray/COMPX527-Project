import type { BoundingBox } from '@derf/shared';

/**
 * Bounding-box parsing, deliberately kept free of any AWS or environment
 * dependency.
 *
 * This previously lived alongside the reports query, which reads
 * `REPORTS_TABLE` at module scope. Importing it from the stations handler — which
 * has no reason to know the reports table exists — was enough to crash that
 * function at cold start, because the environment validation ran on import. A
 * pure function belongs in a module that needs nothing to load.
 */

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

/** True when a point falls inside the box. */
export function withinBoundingBox(
  bbox: BoundingBox,
  point: { lat: number; lon: number },
): boolean {
  return (
    point.lat >= bbox.minLat &&
    point.lat <= bbox.maxLat &&
    point.lon >= bbox.minLon &&
    point.lon <= bbox.maxLon
  );
}
