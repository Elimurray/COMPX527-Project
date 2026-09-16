/**
 * NOAA Global Historical Climatology Network (GHCN-Daily) weather stations.
 *
 * Source: the `noaa-ghcn-pds` bucket on the AWS Registry of Open Data.
 * These provide environmental context beneath live community reports — heavy
 * recent rainfall near a shelter is exactly the sort of thing that changes how a
 * report should be read.
 */

/** The most recent observation set available for a station. */
export interface StationObservation {
  /** ISO date (YYYY-MM-DD) of the observation. */
  date: string;
  /** Precipitation in millimetres. GHCN stores tenths of a millimetre. */
  precipitationMm?: number;
  /** Maximum temperature in °C. GHCN stores tenths of a degree. */
  maxTempC?: number;
  /** Minimum temperature in °C. */
  minTempC?: number;
  /** Average temperature in °C. */
  avgTempC?: number;
}

/** A weather station as returned by the API. */
export interface WeatherStation {
  /** GHCN station identifier, e.g. NZ000093012. */
  stationId: string;
  name: string;
  location: { lat: number; lon: number };
  /** Metres above sea level. */
  elevationM: number;
  /** Geohash of the station location, at GEOHASH_PRECISION. */
  geohash: string;
  /** Latest available observation, absent if the station has reported nothing. */
  latest?: StationObservation;
  /** When this row was last refreshed by the ingestion job. */
  updatedAt: string;
}

/** A station as stored in DynamoDB. The geohash is the partition key. */
export type StationItem = WeatherStation;

export interface ListStationsResponse {
  stations: WeatherStation[];
  /** True when the requested area exceeded the server's cell coverage limit. */
  truncated?: boolean;
}

/** GHCN element codes this project extracts. Others are ignored. */
export const GHCN_ELEMENTS = ['PRCP', 'TMAX', 'TMIN', 'TAVG'] as const;
export type GhcnElement = (typeof GHCN_ELEMENTS)[number];
