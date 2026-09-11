import { GEOHASH_PRECISION } from './constants';
import type { BoundingBox } from './types/api';
import type { GeoPoint } from './types/report';

/** Geohash alphabet — base32, excluding a, i, l and o. */
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * Encodes a coordinate as a geohash of the given precision.
 *
 * A geohash is an interleaved binary search: each character contributes five
 * bits, alternating between narrowing the longitude range and the latitude
 * range. Two points in the same cell therefore share a string prefix, which is
 * what lets DynamoDB find "nearby" reports with an equality match on the
 * partition key instead of a scan.
 */
export function encodeGeohash(
  lat: number,
  lon: number,
  precision: number = GEOHASH_PRECISION,
): string {
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;

  let hash = '';
  let bits = 0;
  let bitCount = 0;
  let evenBit = true; // longitude first

  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) {
        bits = (bits << 1) + 1;
        lonMin = mid;
      } else {
        bits = bits << 1;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        bits = (bits << 1) + 1;
        latMin = mid;
      } else {
        bits = bits << 1;
        latMax = mid;
      }
    }

    evenBit = !evenBit;
    bitCount += 1;

    if (bitCount === 5) {
      hash += BASE32[bits];
      bits = 0;
      bitCount = 0;
    }
  }

  return hash;
}

/**
 * Width and height of a geohash cell, in degrees, at a given precision.
 *
 * Each character adds five bits, split between longitude and latitude — three
 * to one on odd characters, two to three on even ones — so the two axes are
 * divided a different number of times.
 */
export function cellSizeDegrees(precision: number): { lat: number; lon: number } {
  const totalBits = precision * 5;
  const lonBits = Math.ceil(totalBits / 2);
  const latBits = Math.floor(totalBits / 2);
  return {
    lat: 180 / 2 ** latBits,
    lon: 360 / 2 ** lonBits,
  };
}

/** Ceiling on cells per query, so a huge viewport cannot fan out unboundedly. */
export const MAX_QUERY_CELLS = 64;

export interface CellCoverage {
  cells: string[];
  /** True when the bounding box needed more cells than the ceiling allows. */
  truncated: boolean;
}

/**
 * Returns the geohash cells covering a bounding box.
 *
 * The API takes a map viewport, so covering the box directly is both simpler and
 * more accurate than the usual centre-cell-plus-eight-neighbours trick — there
 * is no need to guess a radius. The caller issues one DynamoDB Query per cell,
 * which keeps every read bounded.
 *
 * Coverage is capped at MAX_QUERY_CELLS. A viewport zoomed out far enough to
 * exceed it is asking for a country-sized area, where individual reports are not
 * meaningfully visible anyway; the caller should ask the user to zoom in rather
 * than issue hundreds of queries.
 */
export function cellsForBoundingBox(
  bbox: BoundingBox,
  precision: number = GEOHASH_PRECISION,
  maxCells: number = MAX_QUERY_CELLS,
): CellCoverage {
  const size = cellSizeDegrees(precision);
  const cells = new Set<string>();
  let truncated = false;

  // Step by half a cell so a box smaller than one cell, or straddling a
  // boundary, still samples every cell it touches.
  const latStep = size.lat / 2;
  const lonStep = size.lon / 2;

  outer: for (let lat = bbox.minLat; lat <= bbox.maxLat + latStep; lat += latStep) {
    for (let lon = bbox.minLon; lon <= bbox.maxLon + lonStep; lon += lonStep) {
      const clampedLat = Math.min(lat, bbox.maxLat);
      const clampedLon = Math.min(lon, bbox.maxLon);
      cells.add(encodeGeohash(clampedLat, clampedLon, precision));

      if (cells.size >= maxCells) {
        truncated = true;
        break outer;
      }
    }
  }

  return { cells: [...cells], truncated };
}

/** Convenience wrapper for encoding a report's own location. */
export function geohashForPoint(point: GeoPoint, precision?: number): string {
  return encodeGeohash(point.lat, point.lon, precision);
}
