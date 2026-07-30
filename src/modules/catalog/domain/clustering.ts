import { Coordinates } from './geo';

/**
 * Grid-based map clustering.
 *
 * Never send thousands of raw pins to a map — it stutters and looks like noise.
 * Instead we snap points to a zoom-dependent grid and emit one cluster per
 * occupied cell, so clusters split apart naturally as the user zooms in. This
 * is a pure function over points, which means the Postgres adapter can later
 * push the identical grid maths into SQL (`floor(lng/size)`) without changing
 * the contract or the client.
 */

export interface ClusterInput {
  readonly id: string;
  readonly coordinates: Coordinates;
  /** Optional weight (e.g. wow score) used to pick the cell's representative. */
  readonly weight?: number;
}

export interface MapCluster {
  /** Stable per-viewport id, derived from the grid cell. */
  readonly id: string;
  readonly coordinates: Coordinates;
  readonly count: number;
  /** The single most representative member — what the client renders/labels. */
  readonly representativeId: string;
  /** True when the cluster holds exactly one point (render as a real pin). */
  readonly isSingle: boolean;
}

/** Degrees per grid cell at a given zoom. Halves each zoom level. */
export function cellSizeForZoom(zoom: number): number {
  const clamped = Math.min(Math.max(zoom, 0), 22);
  // At zoom 0 a cell spans 45°; at zoom 10 it is ~0.04°.
  return 45 / 2 ** clamped;
}

export function clusterPoints(points: readonly ClusterInput[], zoom: number): MapCluster[] {
  const size = cellSizeForZoom(zoom);
  const cells = new Map<
    string,
    { latSum: number; lngSum: number; count: number; bestId: string; bestWeight: number }
  >();

  for (const point of points) {
    const col = Math.floor(point.coordinates.lng / size);
    const row = Math.floor(point.coordinates.lat / size);
    const key = `${col}:${row}`;
    const weight = point.weight ?? 0;
    const cell = cells.get(key);

    if (cell === undefined) {
      cells.set(key, {
        latSum: point.coordinates.lat,
        lngSum: point.coordinates.lng,
        count: 1,
        bestId: point.id,
        bestWeight: weight,
      });
      continue;
    }

    cell.latSum += point.coordinates.lat;
    cell.lngSum += point.coordinates.lng;
    cell.count += 1;
    // Ties resolve by id so results are deterministic across requests.
    if (weight > cell.bestWeight || (weight === cell.bestWeight && point.id < cell.bestId)) {
      cell.bestId = point.id;
      cell.bestWeight = weight;
    }
  }

  return [...cells.entries()]
    .map(([key, cell]) => ({
      id: `c${zoom}_${key}`,
      coordinates: { lat: cell.latSum / cell.count, lng: cell.lngSum / cell.count },
      count: cell.count,
      representativeId: cell.bestId,
      isSingle: cell.count === 1,
    }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}
