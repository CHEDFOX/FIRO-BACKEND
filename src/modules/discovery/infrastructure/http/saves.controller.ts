import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AppError } from '../../../../shared/errors/app-error';
import { ZodValidationPipe } from '../../../../shared/http/zod-validation.pipe';
import { toPublicExperience } from '../../../catalog/domain/experience';
import { AuthenticatedUser } from '../../../identity/infrastructure/http/authenticated-user';
import { CurrentUser } from '../../../identity/infrastructure/http/decorators';
import { JwtAuthGuard } from '../../../identity/infrastructure/http/jwt-auth.guard';
import { ListSavedUseCase } from '../../application/list-saved.usecase';
import { SaveExperienceUseCase } from '../../application/save-experience.usecase';
import { UnsaveExperienceUseCase } from '../../application/unsave-experience.usecase';
import {
  SaveExperienceInput,
  SaveExperienceSchema,
  UnsaveQueryInput,
  UnsaveQuerySchema,
} from './saves.dto';

/** Saving places — the explicit taste signal and the source of the personal map. */
@Controller('saves')
@UseGuards(JwtAuthGuard)
export class SavesController {
  constructor(
    private readonly saveExperience: SaveExperienceUseCase,
    private readonly unsaveExperience: UnsaveExperienceUseCase,
    private readonly listSaved: ListSavedUseCase,
  ) {}

  @Post()
  async save(
    @Body(new ZodValidationPipe(SaveExperienceSchema)) body: SaveExperienceInput,
    @CurrentUser() principal: AuthenticatedUser | undefined,
  ) {
    const userId = this.requireUser(principal);
    const result = await this.saveExperience.execute({ userId, ...body });
    return {
      saved: true,
      created: result.created,
      savedAt: result.item.savedAt,
      collection: { id: result.collection.id, name: result.collection.name },
    };
  }

  @Get()
  async list(@CurrentUser() principal: AuthenticatedUser | undefined) {
    const userId = this.requireUser(principal);
    const saved = await this.listSaved.execute(userId);
    return saved.map((entry) => ({
      experience: toPublicExperience(entry.experience),
      savedAt: entry.savedAt,
      note: entry.note,
      collectionId: entry.collectionId,
    }));
  }

  @Get('collections')
  async collections(@CurrentUser() principal: AuthenticatedUser | undefined) {
    const userId = this.requireUser(principal);
    return this.listSaved.listCollections(userId);
  }

  @Delete(':experienceId')
  @HttpCode(200)
  async unsave(
    @Param('experienceId') experienceId: string,
    @Query(new ZodValidationPipe(UnsaveQuerySchema)) query: UnsaveQueryInput,
    @CurrentUser() principal: AuthenticatedUser | undefined,
  ) {
    const userId = this.requireUser(principal);
    return this.unsaveExperience.execute({
      userId,
      experienceId,
      collectionId: query.collectionId,
    });
  }

  private requireUser(principal: AuthenticatedUser | undefined): string {
    if (!principal) {
      throw AppError.unauthenticated();
    }
    return principal.userId;
  }
}
