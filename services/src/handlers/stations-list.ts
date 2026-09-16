import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  COARSE_GEOHASH_PRECISION,
  cellsForBoundingBox,
  type ListStationsResponse,
  type StationItem,
  type WeatherStation,
} from '@derf/shared';
import { ddb, requireEnv } from '../lib/clients';
import { logger } from '../lib/logger';
import { parseBoundingBox, withinBoundingBox } from '../lib/bbox';
import { fail, ok } from '../lib/response';

const TABLE = requireEnv('STATIONS_TABLE');

/**
 * GET /stations?bbox=... — NOAA weather stations in the viewport.
 *
 * Public, and deliberately partitioned by the same geohash scheme as reports, so
 * the contextual layer and the live layer answer the same spatial question the
 * same way. Stations are static enough that no sort key beyond the id is needed.
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const requestId = event.requestContext.requestId;
  const bbox = parseBoundingBox(event.queryStringParameters?.bbox);

  if (!bbox) {
    return fail(
      400,
      'INVALID_BBOX',
      'Query parameter "bbox" must be minLon,minLat,maxLon,maxLat within valid ranges',
      requestId,
    );
  }

  const { cells, truncated } = cellsForBoundingBox(bbox, COARSE_GEOHASH_PRECISION);

  const responses = await Promise.all(
    cells.map((cell) =>
      ddb.send(
        new QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: 'geohash = :cell',
          ExpressionAttributeValues: { ':cell': cell },
        }),
      ),
    ),
  );

  const stations: WeatherStation[] = responses
    .flatMap((response) => (response.Items ?? []) as StationItem[])
    .filter((station) => withinBoundingBox(bbox, station.location));

  logger.info('list stations', {
    requestId,
    cells: cells.length,
    returned: stations.length,
    truncated,
  });

  const body: ListStationsResponse = {
    stations,
    ...(truncated ? { truncated: true } : {}),
  };
  return ok(body);
};
