import { cellSizeForZoom, clusterPoints } from './clustering';

const p = (id: string, lat: number, lng: number, weight = 0) => ({
  id,
  coordinates: { lat, lng },
  weight,
});

describe('map clustering', () => {
  it('shrinks the grid cell as zoom increases', () => {
    expect(cellSizeForZoom(0)).toBeGreaterThan(cellSizeForZoom(5));
    expect(cellSizeForZoom(5)).toBeGreaterThan(cellSizeForZoom(12));
  });

  it('groups nearby points into one cluster when zoomed out', () => {
    // Two Lofoten spots ~5km apart.
    const clusters = clusterPoints([p('a', 67.9333, 13.0894), p('b', 67.9503, 13.1372)], 3);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(2);
    expect(clusters[0].isSingle).toBe(false);
  });

  it('splits those same points apart when zoomed in', () => {
    const clusters = clusterPoints([p('a', 67.9333, 13.0894), p('b', 67.9503, 13.1372)], 14);
    expect(clusters).toHaveLength(2);
    expect(clusters.every((cluster) => cluster.isSingle)).toBe(true);
  });

  it('keeps distant points separate at any zoom', () => {
    const clusters = clusterPoints([p('no', 67.93, 13.08), p('nz', -44.7, 169.15)], 1);
    expect(clusters).toHaveLength(2);
  });

  it('picks the highest-weight member as the representative', () => {
    const clusters = clusterPoints(
      [p('low', 67.9333, 13.0894, 0.1), p('high', 67.9503, 13.1372, 0.9)],
      3,
    );
    expect(clusters[0].representativeId).toBe('high');
  });

  it('places the cluster centre between its members', () => {
    const clusters = clusterPoints([p('a', 10, 10), p('b', 20, 20)], 0);
    expect(clusters[0].coordinates.lat).toBeCloseTo(15, 5);
    expect(clusters[0].coordinates.lng).toBeCloseTo(15, 5);
  });

  it('is deterministic for the same input', () => {
    const points = [p('a', 1, 1, 0.5), p('b', 1.001, 1.001, 0.5), p('c', 50, 50, 0.2)];
    expect(clusterPoints(points, 6)).toEqual(clusterPoints(points, 6));
  });

  it('returns nothing for no points', () => {
    expect(clusterPoints([], 5)).toEqual([]);
  });
});
