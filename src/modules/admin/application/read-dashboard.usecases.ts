import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error';
import {
  ADMIN_QUERIES,
  type AdminActivityEvent,
  type AdminContentPage,
  type AdminContentQuery,
  type AdminMapPoint,
  type AdminOverview,
  type AdminPlaceRow,
  type AdminQueries,
  type AdminUserDetail,
  type AdminUserPage,
  type AdminUserQuery,
} from '../domain/admin-queries';
import { AUDIT_LOG, type AuditEntry, type AuditLog } from '../domain/audit-log';

/**
 * The console's read side.
 *
 * These are thin on purpose — a read model's whole job is to answer the
 * question in one shot, so a use case that re-derives numbers on top of it
 * would just be a second place for the dashboard to be wrong. They exist to
 * own defaults, clamps and the not-found decision, which do not belong in an
 * adapter.
 */

/** Hard ceiling on any admin page, so a hand-edited URL cannot dump the table. */
export const MAX_PAGE = 200;

@Injectable()
export class GetOverviewUseCase {
  constructor(@Inject(ADMIN_QUERIES) private readonly queries: AdminQueries) {}

  async execute(now: Date = new Date()): Promise<AdminOverview> {
    return this.queries.overview(now);
  }
}

@Injectable()
export class ListUsersUseCase {
  constructor(@Inject(ADMIN_QUERIES) private readonly queries: AdminQueries) {}

  async execute(query: AdminUserQuery): Promise<AdminUserPage> {
    return this.queries.listUsers({ ...query, limit: Math.min(query.limit, MAX_PAGE) });
  }
}

@Injectable()
export class GetUserDetailUseCase {
  constructor(@Inject(ADMIN_QUERIES) private readonly queries: AdminQueries) {}

  async execute(userId: string): Promise<AdminUserDetail> {
    const detail = await this.queries.userDetail(userId);
    if (!detail) {
      throw AppError.notFound('admin.user_not_found', 'No such user');
    }
    return detail;
  }
}

@Injectable()
export class ListContentUseCase {
  constructor(@Inject(ADMIN_QUERIES) private readonly queries: AdminQueries) {}

  async execute(query: AdminContentQuery): Promise<AdminContentPage> {
    return this.queries.listContent({ ...query, limit: Math.min(query.limit, MAX_PAGE) });
  }
}

@Injectable()
export class ListPlacesUseCase {
  constructor(@Inject(ADMIN_QUERIES) private readonly queries: AdminQueries) {}

  async execute(): Promise<readonly AdminPlaceRow[]> {
    return this.queries.listPlaces();
  }
}

@Injectable()
export class GetAdminMapUseCase {
  constructor(@Inject(ADMIN_QUERIES) private readonly queries: AdminQueries) {}

  async execute(): Promise<readonly AdminMapPoint[]> {
    return this.queries.mapPoints();
  }
}

@Injectable()
export class GetActivityUseCase {
  constructor(@Inject(ADMIN_QUERIES) private readonly queries: AdminQueries) {}

  /**
   * Events strictly newer than `since`.
   *
   * A missing or unparseable `since` means "the last few minutes", not "all of
   * history" — the live view opening on a year of backlog would be useless and
   * expensive, and a bad cursor should degrade, not explode.
   */
  async execute(since: string | undefined, limit: number): Promise<readonly AdminActivityEvent[]> {
    const cursor =
      since && !Number.isNaN(Date.parse(since))
        ? since
        : new Date(Date.now() - 15 * 60_000).toISOString();
    return this.queries.activitySince(cursor, Math.min(limit, MAX_PAGE));
  }
}

@Injectable()
export class ListAuditLogUseCase {
  constructor(@Inject(AUDIT_LOG) private readonly audit: AuditLog) {}

  async execute(limit: number): Promise<readonly AuditEntry[]> {
    return this.audit.list(Math.min(limit, MAX_PAGE));
  }
}
