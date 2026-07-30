/**
 * Geographic primitives.
 *
 * Coordinates are WGS-84 (the GPS standard). Postgres/PostGIS will store these
 * as `geography(Point,4326)`; the in-memory adapter keeps them as plain numbers
 * so the domain never depends on the database.
 */

export interface Coordinates {
  /** Degrees north, -90..90. */
  readonly lat: number;
  /** Degrees east, -180..180. */
  readonly lng: number;
}

/** A map viewport / bounding box (south-west and north-east corners). */
export interface BoundingBox {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

export function isValidCoordinates(value: Coordinates): boolean {
  return (
    Number.isFinite(value.lat) &&
    Number.isFinite(value.lng) &&
    value.lat >= -90 &&
    value.lat <= 90 &&
    value.lng >= -180 &&
    value.lng <= 180
  );
}

/**
 * Does a bounding box cross the antimeridian (180°/-180°)? When it does, the
 * longitude test must be an OR instead of an AND.
 */
export function crossesAntimeridian(box: BoundingBox): boolean {
  return box.west > box.east;
}

export function containsPoint(box: BoundingBox, point: Coordinates): boolean {
  if (point.lat < box.south || point.lat > box.north) {
    return false;
  }
  return crossesAntimeridian(box)
    ? point.lng >= box.west || point.lng <= box.east
    : point.lng >= box.west && point.lng <= box.east;
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in kilometres (haversine). */
export function distanceKm(a: Coordinates, b: Coordinates): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
