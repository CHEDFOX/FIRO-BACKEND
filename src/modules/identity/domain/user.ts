import { Role } from './role';

export const UserStatus = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  DELETED: 'deleted',
} as const;

export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

/**
 * The User aggregate (identity context). `passwordHash` is nullable to support
 * future OAuth-only accounts. PII fields live here and are isolated to the
 * identity schema (see docs/architecture/04-data-architecture.md).
 */
export interface User {
  readonly id: string;
  readonly handle: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly passwordHash: string | null;
  readonly displayName: string | null;
  readonly locale: string;
  readonly roles: Role[];
  readonly status: UserStatus;
  readonly createdAt: string; // ISO-8601
  readonly updatedAt: string; // ISO-8601
  readonly version: number;
}

/** The safe projection returned to clients — never exposes passwordHash. */
export interface PublicUser {
  readonly id: string;
  readonly handle: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly roles: Role[];
  readonly createdAt: string;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    handle: user.handle,
    email: user.email,
    displayName: user.displayName,
    roles: user.roles,
    createdAt: user.createdAt,
  };
}

export function isActive(user: User): boolean {
  return user.status === UserStatus.ACTIVE;
}
