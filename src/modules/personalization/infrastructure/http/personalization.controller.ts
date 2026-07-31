import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { AppError } from '../../../../shared/errors/app-error';
import { ZodValidationPipe } from '../../../../shared/http/zod-validation.pipe';
import { toPublicExperience } from '../../../catalog/domain/experience';
import { AuthenticatedUser } from '../../../identity/infrastructure/http/authenticated-user';
import { CurrentUser } from '../../../identity/infrastructure/http/decorators';
import { JwtAuthGuard } from '../../../identity/infrastructure/http/jwt-auth.guard';
import { BuildFeedUseCase } from '../../application/build-feed.usecase';
import { GetDnaUseCase } from '../../application/get-dna.usecase';
import { RecordSignalUseCase } from '../../application/record-signal.usecase';
import { SignalKind } from '../../domain/signal';
import {
  FeedQueryInput,
  FeedQuerySchema,
  RecordSignalInput,
  RecordSignalSchema,
} from './personalization.dto';

/**
 * The personalised surface: the feed, the signals that teach it, and the
 * user's own view of their evolving taste.
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class PersonalizationController {
  constructor(
    private readonly buildFeed: BuildFeedUseCase,
    private readonly recordSignal: RecordSignalUseCase,
    private readonly getDna: GetDnaUseCase,
  ) {}

  @Get('feed')
  async feed(
    @Query(new ZodValidationPipe(FeedQuerySchema)) query: FeedQueryInput,
    @CurrentUser() principal: AuthenticatedUser | undefined,
  ) {
    const userId = this.requireUser(principal);
    const items = await this.buildFeed.execute({
      userId,
      sessionId: query.sessionId,
      limit: query.limit,
      month: query.month,
    });

    return items.map((item) => ({
      experience: toPublicExperience(item.experience),
      reason: item.reason,
      isWildcard: item.isWildcard,
      // Rounded: useful for debugging and tuning, not a precise internal score.
      score: Number(item.score.toFixed(4)),
    }));
  }

  @Post('signals')
  @HttpCode(202)
  async signal(
    @Body(new ZodValidationPipe(RecordSignalSchema)) body: RecordSignalInput,
    @CurrentUser() principal: AuthenticatedUser | undefined,
  ) {
    const userId = this.requireUser(principal);
    return this.recordSignal.execute({
      userId,
      kind: body.kind as SignalKind,
      experienceId: body.experienceId,
      sessionId: body.sessionId,
      durationMs: body.durationMs,
    });
  }

  @Get('me/dna')
  async dna(@CurrentUser() principal: AuthenticatedUser | undefined) {
    const userId = this.requireUser(principal);
    return this.getDna.execute(userId);
  }

  private requireUser(principal: AuthenticatedUser | undefined): string {
    if (!principal) {
      throw AppError.unauthenticated();
    }
    return principal.userId;
  }
}
