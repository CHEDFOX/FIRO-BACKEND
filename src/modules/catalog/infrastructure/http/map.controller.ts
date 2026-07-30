import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AppError } from '../../../../shared/errors/app-error';
import { ZodValidationPipe } from '../../../../shared/http/zod-validation.pipe';
import { ListSavedUseCase } from '../../../discovery/application/list-saved.usecase';
import { AuthenticatedUser } from '../../../identity/infrastructure/http/authenticated-user';
import { CurrentUser, OptionalAuth } from '../../../identity/infrastructure/http/decorators';
import { JwtAuthGuard } from '../../../identity/infrastructure/http/jwt-auth.guard';
import { MapView, MapViewUseCase } from '../../application/map-view.usecase';
import { MapViewQueryInput, MapViewQuerySchema } from './catalog.dto';

/**
 * GET /v1/map — everything a map screen needs for one viewport.
 *
 * The response is deliberately presentation-agnostic: it says *what* is there
 * (clusters + representative pins), never how to draw it. The client is free to
 * render it as a flat map or a tilted 3D globe with terrain and fly-to
 * animations without any change here.
 */
@Controller('map')
@UseGuards(JwtAuthGuard)
export class MapController {
  constructor(
    private readonly mapView: MapViewUseCase,
    private readonly listSaved: ListSavedUseCase,
  ) {}

  @Get()
  @OptionalAuth()
  async view(
    @Query(new ZodValidationPipe(MapViewQuerySchema)) query: MapViewQueryInput,
    @CurrentUser() principal: AuthenticatedUser | undefined,
  ): Promise<MapView> {
    let savedExperienceIds: ReadonlySet<string> | undefined;

    if (query.saved) {
      if (!principal) {
        throw AppError.unauthenticated(
          'auth.required_for_saved_map',
          'Sign in to see your saved places on the map',
        );
      }
      savedExperienceIds = await this.listSaved.savedIds(principal.userId);
    }

    return this.mapView.execute({
      bounds: {
        south: query.south,
        west: query.west,
        north: query.north,
        east: query.east,
      },
      zoom: query.zoom,
      savedExperienceIds,
    });
  }
}
