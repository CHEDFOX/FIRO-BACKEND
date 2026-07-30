import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error';
import { CATALOG_REPOSITORY, CatalogRepository } from '../domain/catalog.repository';
import { clusterPoints, MapCluster } from '../domain/clustering';
import { Experience } from '../domain/experience';
import { BoundingBox } from '../domain/geo';

/** Hard ceiling on points considered per viewport request, to bound the work. */
export const MAP_VIEWPORT_LIMIT = 2000;

export interface MapViewQuery {
  readonly bounds: BoundingBox;
  readonly zoom: number;
  /** When provided, restrict pins to this user's saved experiences. */
  readonly savedExperienceIds?: ReadonlySet<string>;
}

export interface MapPin {
  readonly experienceId: string;
  readonly slug: string;
  readonly title: string;
  readonly lat: number;
  readonly lng: number;
  readonly dominantColor: string | null;
}

export interface MapView {
  readonly clusters: MapCluster[];
  /** Details for each cluster's representative, so the client can label pins. */
  readonly pins: MapPin[];
  readonly totalInView: number;
  readonly truncated: boolean;
}

/**
 * Answers the only question a map screen asks: "what is in this viewport?"
 *
 * The backend decides *what* appears (which experiences, how they group); the
 * client decides *how* it looks — flat map, 3D globe, tilt, terrain, fly-to
 * animations. That boundary is why the map can become fully three-dimensional
 * later without any backend change.
 */
@Injectable()
export class MapViewUseCase {
  constructor(@Inject(CATALOG_REPOSITORY) private readonly catalog: CatalogRepository) {}

  async execute(query: MapViewQuery): Promise<MapView> {
    this.assertValidBounds(query.bounds);

    const found = await this.catalog.withinBounds(query.bounds, MAP_VIEWPORT_LIMIT + 1);
    const truncated = found.length > MAP_VIEWPORT_LIMIT;
    let visible = truncated ? found.slice(0, MAP_VIEWPORT_LIMIT) : found;

    if (query.savedExperienceIds) {
      const saved = query.savedExperienceIds;
      visible = visible.filter((experience) => saved.has(experience.id));
    }

    const clusters = clusterPoints(
      visible.map((experience) => ({
        id: experience.id,
        coordinates: experience.coordinates,
        weight: experience.wowScore,
      })),
      query.zoom,
    );

    const byId = new Map(visible.map((experience) => [experience.id, experience]));
    const pins = clusters
      .map((cluster) => byId.get(cluster.representativeId))
      .filter((experience): experience is Experience => experience !== undefined)
      .map((experience): MapPin => ({
        experienceId: experience.id,
        slug: experience.slug,
        title: experience.title,
        lat: experience.coordinates.lat,
        lng: experience.coordinates.lng,
        dominantColor: experience.media[0]?.dominantColor ?? null,
      }));

    return { clusters, pins, totalInView: visible.length, truncated };
  }

  private assertValidBounds(bounds: BoundingBox): void {
    const inRange =
      bounds.south >= -90 &&
      bounds.north <= 90 &&
      bounds.south <= bounds.north &&
      bounds.west >= -180 &&
      bounds.west <= 180 &&
      bounds.east >= -180 &&
      bounds.east <= 180;
    if (!inRange) {
      throw AppError.validation('map.invalid_bounds', 'The map bounds are invalid', { bounds });
    }
  }
}
