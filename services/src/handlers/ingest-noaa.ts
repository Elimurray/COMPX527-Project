import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import type { Handler } from 'aws-lambda';
import {
  STATION_GEOHASH_PRECISION,
  encodeGeohash,
  type StationItem,
  type StationObservation,
} from '@derf/shared';
import { ddb, requireEnv } from '../lib/clients';
import { logger } from '../lib/logger';

/**
 * Ingests NOAA GHCN-Daily station metadata and recent observations.
 *
 * Source: `noaa-ghcn-pds`, published on the AWS Registry of Open Data. The bucket
 * is read cross-account with an IAM grant scoped to that bucket alone.
 *
 * Runs on a schedule rather than on demand: GHCN is a historical/observational
 * dataset updated daily at best, so polling it per user request would be pure
 * waste. A weekly refresh is ample.
 */

const s3 = new S3Client({});

const NOAA_BUCKET = 'noaa-ghcn-pds';
const STATIONS_KEY = 'ghcnd-stations.txt';

const DATASETS_BUCKET = requireEnv('DATASETS_BUCKET');
const STATIONS_TABLE = requireEnv('STATIONS_TABLE');

/**
 * Which stations to ingest, by GHCN country prefix.
 *
 * GHCN carries ~132,500 stations worldwide. Ingesting all of them would cost far
 * more in writes and storage than this project's budget allows, and the
 * application serves New Zealand.
 */
const COUNTRY_PREFIX = process.env.GHCN_COUNTRY_PREFIX ?? 'NZ';

/**
 * How much of each per-station observation file to read, from the end.
 *
 * These files hold decades of daily rows and run to ~2 MB each. Only the most
 * recent observations matter here, and they are at the end of the file, so an S3
 * range request for the final 64 KB replaces a 2 MB download — roughly a
 * thirty-fold reduction in transfer per station.
 */
const TAIL_BYTES = 65536;

async function readObject(bucket: string, key: string, range?: string): Promise<string> {
  const response = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key, Range: range }),
  );
  return response.Body!.transformToString();
}

/** GHCN's station file is fixed-width, not delimited. */
interface ParsedStation {
  stationId: string;
  lat: number;
  lon: number;
  elevationM: number;
  name: string;
}

function parseStations(text: string, prefix: string): ParsedStation[] {
  const stations: ParsedStation[] = [];

  for (const line of text.split('\n')) {
    if (!line.startsWith(prefix)) continue;

    // Column positions are defined by GHCN's readme.txt and are stable.
    const stationId = line.slice(0, 11).trim();
    const lat = Number(line.slice(12, 20).trim());
    const lon = Number(line.slice(21, 30).trim());
    const elevationM = Number(line.slice(31, 37).trim());
    const name = line.slice(41, 71).trim();

    if (!stationId || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    stations.push({ stationId, lat, lon, elevationM, name });
  }

  return stations;
}

/**
 * Extracts the most recent observation set from the tail of a station's CSV.
 *
 * GHCN stores values as integers in tenths of the base unit, so each is divided
 * by ten. Rows carrying a quality-control flag are skipped — a value NOAA itself
 * marks as suspect should not be shown next to emergency information.
 */
function parseLatestObservation(csv: string): StationObservation | undefined {
  const lines = csv.split('\n');
  // The first line of a range-read is almost certainly truncated mid-row.
  lines.shift();

  const byDate = new Map<string, Record<string, number>>();

  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length < 7) continue;

    const [, date, element, rawValue, , qFlag] = parts as string[];
    if (!date || !element || !rawValue) continue;
    if (qFlag && qFlag.trim() !== '') continue;

    const value = Number(rawValue);
    if (!Number.isFinite(value)) continue;

    const existing = byDate.get(date) ?? {};
    existing[element] = value;
    byDate.set(date, existing);
  }

  if (byDate.size === 0) return undefined;

  const latestDate = [...byDate.keys()].sort().pop()!;
  const elements = byDate.get(latestDate)!;

  const iso = `${latestDate.slice(0, 4)}-${latestDate.slice(4, 6)}-${latestDate.slice(6, 8)}`;

  const observation: StationObservation = { date: iso };
  if (elements.PRCP !== undefined) observation.precipitationMm = elements.PRCP / 10;
  if (elements.TMAX !== undefined) observation.maxTempC = elements.TMAX / 10;
  if (elements.TMIN !== undefined) observation.minTempC = elements.TMIN / 10;
  if (elements.TAVG !== undefined) observation.avgTempC = elements.TAVG / 10;

  return observation;
}

export const handler: Handler = async () => {
  const startedAt = Date.now();
  logger.info('ingestion started', { source: NOAA_BUCKET, prefix: COUNTRY_PREFIX });

  const stationsText = await readObject(NOAA_BUCKET, STATIONS_KEY);

  // Archive the raw pull before transforming it. If the parser is later found to
  // be wrong, the source data for each run is still available to reprocess.
  const runDate = new Date().toISOString().slice(0, 10);
  const archiveKey = `raw/noaa/ghcn/stations/${runDate}.txt`;
  await s3.send(
    new PutObjectCommand({
      Bucket: DATASETS_BUCKET,
      Key: archiveKey,
      Body: stationsText,
      ContentType: 'text/plain',
    }),
  );

  const stations = parseStations(stationsText, COUNTRY_PREFIX);
  logger.info('stations parsed', { count: stations.length, archiveKey });

  let withObservations = 0;
  let failures = 0;

  for (const station of stations) {
    let latest: StationObservation | undefined;

    try {
      const csv = await readObject(
        NOAA_BUCKET,
        `csv/by_station/${station.stationId}.csv`,
        `bytes=-${TAIL_BYTES}`,
      );
      latest = parseLatestObservation(csv);
      if (latest) withObservations += 1;
    } catch (error) {
      // A station with no observation file is normal, not fatal. Its metadata is
      // still worth storing so it appears on the map.
      failures += 1;
      logger.warn('no observations for station', {
        stationId: station.stationId,
        reason: String(error),
      });
    }

    const item: StationItem = {
      stationId: station.stationId,
      name: station.name,
      location: { lat: station.lat, lon: station.lon },
      elevationM: station.elevationM,
      geohash: encodeGeohash(station.lat, station.lon, STATION_GEOHASH_PRECISION),
      ...(latest ? { latest } : {}),
      updatedAt: new Date().toISOString(),
    };

    // Plain put, not conditional: this job refreshes station state, so the newest
    // run should overwrite the previous one.
    await ddb.send(new PutCommand({ TableName: STATIONS_TABLE, Item: item }));
  }

  const summary = {
    stations: stations.length,
    withObservations,
    failures,
    durationMs: Date.now() - startedAt,
  };
  logger.info('ingestion complete', summary);
  return summary;
};
