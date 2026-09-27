import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../../../shared/errors/app-error';
import { ZodValidationPipe } from '../../../../shared/http/zod-validation.pipe';
import { ALL_TAGS, type Tag } from '../../../catalog/domain/taxonomy';
import type { AuthenticatedUser } from '../../../identity/infrastructure/http/authenticated-user';
import { CurrentUser } from '../../../identity/infrastructure/http/decorators';
import { JwtAuthGuard } from '../../../identity/infrastructure/http/jwt-auth.guard';
import {
  GetTodayUseCase,
  GetWorldUseCase,
  ListDaysUseCase,
  RhythmUseCases,
} from '../../application/daily.usecases';
import { isValidTimeZone } from '../../domain/daily';

const timeZone = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, 'Unknown time zone. Send an IANA name such as "Europe/Oslo".')
  .default('UTC');

const TodayQuerySchema = z.object({ tz: timeZone });
type TodayQuery = z.infer<typeof TodayQuerySchema>;

const DaysQuerySchema = z.object({
  tz: timeZone,
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM, e.g. 2026-09')
    .optional(),
});
type DaysQuery = z.infer<typeof DaysQuerySchema>;

const RhythmSchema = z.object({
  mode: z.enum(['morning', 'evening', 'none']),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM, e.g. 07:30')
    .nullable()
    .optional(),
  tz: timeZone,
});
type RhythmInput = z.infer<typeof RhythmSchema>;

const TomorrowSchema = z.object({
  surprise: z.boolean(),
  toward: z
    .enum(ALL_TAGS as unknown as [string, ...string[]])
    .nullable()
    .optional(),
});
type TomorrowInput = z.infer<typeof TomorrowSchema>;

/**
 * The daily ritual.
 *
 *   GET  /v1/today          the one place for today (stable all day)
 *   GET  /v1/days           the month's quilt, with a sentence about it
 *   GET  /v1/world          everything kept, on a map, with a sentence
 *   GET  /v1/me/rhythm      when the daily note should arrive
 *   PUT  /v1/me/rhythm
 *   PUT  /v1/tomorrow       "shall tomorrow be somewhere warm?"
 *
 * Every route takes the user's time zone, because "today" is theirs, not the
 * server's.
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class DailyController {
  constructor(
    private readonly today: GetTodayUseCase,
    private readonly days: ListDaysUseCase,
    private readonly world: GetWorldUseCase,
    private readonly rhythm: RhythmUseCases,
  ) {}

  @Get('today')
  async getToday(
    @Query(new ZodValidationPipe(TodayQuerySchema)) query: TodayQuery,
    @CurrentUser() principal: AuthenticatedUser | undefined,
  ) {
    return this.today.execute({ userId: requireUser(principal), timeZone: query.tz });
  }

  @Get('days')
  async getDays(
    @Query(new ZodValidationPipe(DaysQuerySchema)) query: DaysQuery,
    @CurrentUser() principal: AuthenticatedUser | undefined,
  ) {
    return this.days.execute({
      userId: requireUser(principal),
      month: query.month,
      timeZone: query.tz,
    });
  }

  @Get('world')
  async getWorld(@CurrentUser() principal: AuthenticatedUser | undefined) {
    return this.world.execute(requireUser(principal));
  }

  @Get('me/rhythm')
  async getRhythm(@CurrentUser() principal: AuthenticatedUser | undefined) {
    return this.rhythm.get(requireUser(principal));
  }

  @Put('me/rhythm')
  async putRhythm(
    @Body(new ZodValidationPipe(RhythmSchema)) body: RhythmInput,
    @CurrentUser() principal: AuthenticatedUser | undefined,
  ) {
    return this.rhythm.setRhythm({
      userId: requireUser(principal),
      mode: body.mode,
      time: body.time ?? null,
      timeZone: body.tz,
    });
  }

  @Put('tomorrow')
  async putTomorrow(
    @Body(new ZodValidationPipe(TomorrowSchema)) body: TomorrowInput,
    @CurrentUser() principal: AuthenticatedUser | undefined,
  ) {
    const rhythm = await this.rhythm.setTomorrow({
      userId: requireUser(principal),
      surprise: body.surprise,
      toward: (body.toward as Tag | null | undefined) ?? null,
    });
    return { surpriseTomorrow: rhythm.surpriseNext, toward: rhythm.surpriseToward };
  }
}

function requireUser(principal: AuthenticatedUser | undefined): string {
  if (!principal) {
    throw AppError.unauthenticated();
  }
  return principal.userId;
}
