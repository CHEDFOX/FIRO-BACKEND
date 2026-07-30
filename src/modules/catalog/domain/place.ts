import { Coordinates } from './geo';

/**
 * The geographic hierarchy: Country > Region > City > Place.
 *
 * A Place is a physical location (a town, a fjord, a national park). An
 * Experience (see experience.ts) is the *thing you go there to feel* and is
 * what the feed and the map actually surface.
 */

export interface Country {
  readonly id: string;
  /** ISO-3166-1 alpha-2, e.g. "NO". */
  readonly code: string;
  readonly name: string;
  readonly slug: string;
}

export interface Region {
  readonly id: string;
  readonly countryId: string;
  readonly name: string;
  readonly slug: string;
}

export interface Place {
  readonly id: string;
  readonly countryId: string;
  readonly regionId: string | null;
  readonly name: string;
  readonly slug: string;
  readonly coordinates: Coordinates;
  /** Metres above sea level; feeds the 3D map's terrain framing. */
  readonly elevationMeters: number | null;
  readonly timezone: string | null;
}
