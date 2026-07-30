import { containsPoint, crossesAntimeridian, distanceKm, isValidCoordinates } from './geo';

describe('geo', () => {
  describe('isValidCoordinates', () => {
    it('accepts real coordinates and rejects impossible ones', () => {
      expect(isValidCoordinates({ lat: 67.93, lng: 13.09 })).toBe(true);
      expect(isValidCoordinates({ lat: 91, lng: 0 })).toBe(false);
      expect(isValidCoordinates({ lat: 0, lng: 181 })).toBe(false);
      expect(isValidCoordinates({ lat: Number.NaN, lng: 0 })).toBe(false);
    });
  });

  describe('containsPoint', () => {
    const europe = { south: 35, west: -10, north: 71, east: 40 };

    it('detects points inside and outside a box', () => {
      expect(containsPoint(europe, { lat: 67.93, lng: 13.09 })).toBe(true); // Lofoten
      expect(containsPoint(europe, { lat: 35.0, lng: 135.7 })).toBe(false); // Kyoto
    });

    it('handles a viewport crossing the antimeridian', () => {
      const pacific = { south: -50, west: 160, north: -30, east: -170 };
      expect(crossesAntimeridian(pacific)).toBe(true);
      expect(containsPoint(pacific, { lat: -44.7, lng: 169.15 })).toBe(true); // Wanaka
      expect(containsPoint(pacific, { lat: -44.7, lng: -175 })).toBe(true); // east side
      expect(containsPoint(pacific, { lat: -44.7, lng: 0 })).toBe(false);
    });
  });

  describe('distanceKm', () => {
    it('is zero for the same point', () => {
      expect(distanceKm({ lat: 10, lng: 10 }, { lat: 10, lng: 10 })).toBeCloseTo(0, 6);
    });

    it('approximates a known distance (Reine -> Hamnoy is a few km)', () => {
      const d = distanceKm({ lat: 67.9333, lng: 13.0894 }, { lat: 67.9503, lng: 13.1372 });
      expect(d).toBeGreaterThan(1);
      expect(d).toBeLessThan(6);
    });

    it('is symmetric', () => {
      const a = { lat: 35.0, lng: 135.7 };
      const b = { lat: -13.16, lng: -72.5 };
      expect(distanceKm(a, b)).toBeCloseTo(distanceKm(b, a), 6);
    });
  });
});
