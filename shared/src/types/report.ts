/** The kinds of resource a community member can report on. */
export const RESOURCE_TYPES = [
  'shelter',
  'water',
  'food',
  'medical',
  'fuel',
  'power',
  'supplies',
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

/** Current availability of a resource at a location. */
export const RESOURCE_STATUS = [
  'available',
  'limited',
  'unavailable',
  'unknown',
] as const;
export type ResourceStatus = (typeof RESOURCE_STATUS)[number];

export interface GeoPoint {
  lat: number;
  lon: number;
}

/**
 * A resource report as stored and returned by the API.
 *
 * Storage note: `geohash` is the DynamoDB partition key candidate and
 * `reportedAt` the sort key candidate — confirm before M2 writes anything real.
 */
export interface Report {
  reportId: string;
  resourceType: ResourceType;
  status: ResourceStatus;
  location: GeoPoint;
  /** Geohash of `location` at GEOHASH_PRECISION, used to bucket nearby lookups. */
  geohash: string;
  /** Free-text detail from the reporter, e.g. "queue is about an hour". */
  note?: string;
  /** Shelter capacity, where the resource type makes it meaningful. */
  capacity?: {
    current: number;
    maximum: number;
  };
  /** S3 object keys for any attached photos. */
  imageKeys?: string[];
  /** Cognito `sub` of the reporter. */
  reportedBy: string;
  /** ISO 8601 timestamp. */
  reportedAt: string;
}

/** What a client sends to create a report — server owns the rest. */
export type CreateReportInput = Pick<
  Report,
  'resourceType' | 'status' | 'location' | 'note' | 'capacity' | 'imageKeys'
>;
