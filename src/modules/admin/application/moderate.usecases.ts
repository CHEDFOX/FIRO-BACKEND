import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error';
import {
  CATALOG_REPOSITORY,
  type CatalogRepository,
} from '../../catalog/domain/catalog.repository';
import { CATALOG_WRITER, type CatalogWriter } from '../../catalog/domain/catalog-writer';
import { Role } from '../../identity/domain/role';
import { type User, UserStatus } from '../../identity/domain/user';
import { USER_REPOSITORY, type UserRepository } from '../../identity/domain/user.repository';
import { AUDIT_LOG, type AuditLog } from '../domain/audit-log';
import type { Actor } from './upsert-experience.usecase';

/**
 * Actions that change someone else's account or remove content. Every one is
 * audited, and every one refuses the move that would lock the operator out or
 * quietly destroy user data.
 */

@Injectable()
export class SetUserStatusUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
  ) {}

  async execute(userId: string, status: UserStatus, actor: Actor): Promise<User> {
    if (userId === actor.id && status !== UserStatus.ACTIVE) {
      throw AppError.validation(
        'admin.cannot_suspend_self',
        'You cannot suspend or delete your own account from the console.',
      );
    }

    const user = await this.users.findById(userId);
    if (!user) {
      throw AppError.notFound('admin.user_not_found', 'No such user');
    }

    const now = new Date().toISOString();
    const updated: User = { ...user, status, updatedAt: now, version: user.version + 1 };
    await this.users.save(updated);

    await this.audit.record({
      actorId: actor.id,
      actorHandle: actor.handle,
      action: `user.${status}`,
      targetType: 'user',
      targetId: user.id,
      before: { status: user.status },
      after: { status },
      at: now,
    });

    return updated;
  }
}

@Injectable()
export class SetUserRolesUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
  ) {}

  async execute(userId: string, roles: readonly Role[], actor: Actor): Promise<User> {
    const next = [...new Set(roles)];
    if (!next.includes(Role.USER)) {
      // Every account is a user first; the other roles are additive. Dropping
      // it would leave an account that cannot use the app it administers.
      next.unshift(Role.USER);
    }
    if (userId === actor.id && !next.includes(Role.ADMIN)) {
      throw AppError.validation(
        'admin.cannot_demote_self',
        'You cannot remove your own admin role — ask another admin to do it.',
      );
    }

    const user = await this.users.findById(userId);
    if (!user) {
      throw AppError.notFound('admin.user_not_found', 'No such user');
    }

    const now = new Date().toISOString();
    const updated: User = { ...user, roles: next, updatedAt: now, version: user.version + 1 };
    await this.users.save(updated);

    await this.audit.record({
      actorId: actor.id,
      actorHandle: actor.handle,
      action: 'user.roles_changed',
      targetType: 'user',
      targetId: user.id,
      before: { roles: user.roles },
      after: { roles: next },
      at: now,
    });

    return updated;
  }
}

@Injectable()
export class DeleteExperienceUseCase {
  constructor(
    @Inject(CATALOG_REPOSITORY) private readonly catalog: CatalogRepository,
    @Inject(CATALOG_WRITER) private readonly writer: CatalogWriter,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
  ) {}

  /**
   * Hard delete. Cascades to every save that references the experience, so the
   * console asks for confirmation and the console's own default action is
   * archiving instead. The full row goes into the audit log first — that record
   * is the only way back.
   */
  async execute(experienceId: string, actor: Actor): Promise<void> {
    const existing = await this.catalog.findExperienceById(experienceId);
    if (!existing) {
      throw AppError.notFound('admin.experience_not_found', 'No such experience');
    }

    const now = new Date().toISOString();
    await this.audit.record({
      actorId: actor.id,
      actorHandle: actor.handle,
      action: 'experience.deleted',
      targetType: 'experience',
      targetId: experienceId,
      before: existing,
      after: null,
      at: now,
    });

    await this.writer.deleteExperience(experienceId);
  }
}
