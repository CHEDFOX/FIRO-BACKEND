import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Sse,
  UseGuards,
  type MessageEvent,
} from '@nestjs/common';
import { Observable, concat, defer, from, interval, of } from 'rxjs';
import { concatMap, map } from 'rxjs/operators';
import { RawResponse } from '../../../../shared/http/raw-response.decorator';
import { ZodValidationPipe } from '../../../../shared/http/zod-validation.pipe';
import type { BudgetBand, Tag } from '../../../catalog/domain/taxonomy';
import type { ExperienceStatus } from '../../../catalog/domain/experience';
import { Role } from '../../../identity/domain/role';
import { toPublicUser } from '../../../identity/domain/user';
import type { UserStatus } from '../../../identity/domain/user';
import type { AuthenticatedUser } from '../../../identity/infrastructure/http/authenticated-user';
import { CurrentUser, Roles } from '../../../identity/infrastructure/http/decorators';
import { JwtAuthGuard } from '../../../identity/infrastructure/http/jwt-auth.guard';
import { RolesGuard } from '../../../identity/infrastructure/http/roles.guard';
import {
  DeleteExperienceUseCase,
  SetUserRolesUseCase,
  SetUserStatusUseCase,
} from '../../application/moderate.usecases';
import {
  GetActivityUseCase,
  GetAdminMapUseCase,
  GetOverviewUseCase,
  GetUserDetailUseCase,
  ListAuditLogUseCase,
  ListContentUseCase,
  ListPlacesUseCase,
  ListUsersUseCase,
} from '../../application/read-dashboard.usecases';
import { ResolveActor } from '../../application/resolve-actor';
import { UpsertExperienceUseCase } from '../../application/upsert-experience.usecase';
import {
  ActivityQuerySchema,
  ContentListQuerySchema,
  SetUserRolesSchema,
  SetUserStatusSchema,
  UpsertExperienceSchema,
  UserListQuerySchema,
  type ActivityQueryInput,
  type ContentListQueryInput,
  type SetUserRolesInput,
  type SetUserStatusInput,
  type UpsertExperienceInput,
  type UserListQueryInput,
} from './admin.dto';

/** How often the live stream looks for new activity. */
const STREAM_POLL_MS = 2500;

/**
 * The private admin console API.
 *
 * Every route requires an authenticated **admin**. There is no read-only tier
 * and no public preview: this surface exposes email addresses, behavioural
 * history and taste profiles for every account, so a partially-protected
 * version of it would be worse than none.
 */
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminController {
  constructor(
    private readonly overview: GetOverviewUseCase,
    private readonly listUsers: ListUsersUseCase,
    private readonly userDetail: GetUserDetailUseCase,
    private readonly listContent: ListContentUseCase,
    private readonly listPlaces: ListPlacesUseCase,
    private readonly adminMap: GetAdminMapUseCase,
    private readonly activity: GetActivityUseCase,
    private readonly auditLog: ListAuditLogUseCase,
    private readonly upsertExperience: UpsertExperienceUseCase,
    private readonly deleteExperience: DeleteExperienceUseCase,
    private readonly setUserStatus: SetUserStatusUseCase,
    private readonly setUserRoles: SetUserRolesUseCase,
    private readonly resolveActor: ResolveActor,
  ) {}

  @Get('overview')
  async getOverview() {
    return this.overview.execute();
  }

  @Get('users')
  async users(@Query(new ZodValidationPipe(UserListQuerySchema)) query: UserListQueryInput) {
    return this.listUsers.execute({
      limit: query.limit,
      offset: query.offset,
      search: query.search,
      status: query.status as UserStatus | undefined,
      role: query.role as Role | undefined,
    });
  }

  @Get('users/:id')
  async user(@Param('id') id: string) {
    return this.userDetail.execute(id);
  }

  @Put('users/:id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetUserStatusSchema)) body: SetUserStatusInput,
    @CurrentUser() principal: AuthenticatedUser,
  ) {
    const actor = await this.resolveActor.execute(principal.userId);
    const user = await this.setUserStatus.execute(id, body.status as UserStatus, actor);
    return { user: toPublicUser(user), status: user.status };
  }

  @Put('users/:id/roles')
  async updateRoles(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetUserRolesSchema)) body: SetUserRolesInput,
    @CurrentUser() principal: AuthenticatedUser,
  ) {
    const actor = await this.resolveActor.execute(principal.userId);
    const user = await this.setUserRoles.execute(id, body.roles as Role[], actor);
    return { user: toPublicUser(user) };
  }

  @Get('content')
  async content(
    @Query(new ZodValidationPipe(ContentListQuerySchema)) query: ContentListQueryInput,
  ) {
    return this.listContent.execute({
      limit: query.limit,
      offset: query.offset,
      search: query.search,
      status: query.status as ExperienceStatus | undefined,
    });
  }

  /** The editor's place picker. Reference data, so it is a plain list. */
  @Get('places')
  async places() {
    return this.listPlaces.execute();
  }

  @Post('content')
  @HttpCode(201)
  async createContent(
    @Body(new ZodValidationPipe(UpsertExperienceSchema)) body: UpsertExperienceInput,
    @CurrentUser() principal: AuthenticatedUser,
  ) {
    const actor = await this.resolveActor.execute(principal.userId);
    // A POST creates; an id in the body would silently overwrite an existing
    // row, so it is ignored rather than honoured.
    return this.upsertExperience.execute({ ...toCommand(body), id: undefined }, actor);
  }

  @Put('content/:id')
  async updateContent(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpsertExperienceSchema)) body: UpsertExperienceInput,
    @CurrentUser() principal: AuthenticatedUser,
  ) {
    const actor = await this.resolveActor.execute(principal.userId);
    return this.upsertExperience.execute({ ...toCommand(body), id }, actor);
  }

  @Delete('content/:id')
  @HttpCode(204)
  async removeContent(@Param('id') id: string, @CurrentUser() principal: AuthenticatedUser) {
    const actor = await this.resolveActor.execute(principal.userId);
    await this.deleteExperience.execute(id, actor);
  }

  @Get('map')
  async map() {
    return this.adminMap.execute();
  }

  @Get('activity')
  async recentActivity(
    @Query(new ZodValidationPipe(ActivityQuerySchema)) query: ActivityQueryInput,
  ) {
    return this.activity.execute(query.since, query.limit);
  }

  @Get('audit')
  async audit(@Query(new ZodValidationPipe(ActivityQuerySchema)) query: ActivityQueryInput) {
    return this.auditLog.execute(query.limit);
  }

  /**
   * Live activity as Server-Sent Events.
   *
   * Polls the read model and pushes only what is new — a push architecture
   * (an event bus every use case writes to) would be tidier, but it would mean
   * threading a publisher through modules that currently have no idea the
   * console exists. This buys the live feel for zero coupling, and the seam to
   * replace it later is this one method.
   *
   * Marked @RawResponse() so the envelope interceptor does not wrap each event.
   */
  @Sse('stream')
  @RawResponse()
  stream(): Observable<MessageEvent> {
    let cursor = new Date().toISOString();

    const poll = defer(() =>
      from(this.activity.execute(cursor, 50)).pipe(
        map((events): MessageEvent[] => {
          if (events.length > 0) {
            // Events arrive newest-first; the cursor is the newest we've seen.
            cursor = events[0]!.at;
          }
          // Oldest-first on the wire so the client can append.
          return [...events]
            .reverse()
            .map((event) => ({ type: 'activity', data: JSON.stringify(event) }));
        }),
      ),
    );

    // A heartbeat first, so the client knows the stream is open even on a quiet
    // system, and so proxies with an idle timeout keep it alive.
    return concat(
      of<MessageEvent>({ type: 'hello', data: JSON.stringify({ at: cursor }) }),
      interval(STREAM_POLL_MS).pipe(
        concatMap(() => poll),
        concatMap((events) =>
          events.length > 0
            ? from(events)
            : of<MessageEvent>({ type: 'heartbeat', data: JSON.stringify({ at: cursor }) }),
        ),
      ),
    );
  }
}

function toCommand(body: UpsertExperienceInput) {
  return {
    id: body.id,
    placeId: body.placeId,
    slug: body.slug,
    title: body.title,
    summary: body.summary,
    story: body.story ?? null,
    lat: body.lat,
    lng: body.lng,
    tags: body.tags as Tag[],
    budgetBand: body.budgetBand as BudgetBand,
    months: body.months,
    difficulty: body.difficulty,
    wowScore: body.wowScore,
    hiddenGemScore: body.hiddenGemScore,
    media: body.media,
    status: body.status as ExperienceStatus,
  };
}
