import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role } from '../../domain/role';
import { AuthenticatedUser, RequestWithUser } from './authenticated-user';

/** Marks a route as public — JwtAuthGuard skips authentication. */
export const IS_PUBLIC_KEY = 'firo:is_public';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Marks a route as usable with or without a token: a valid Bearer token
 * populates `request.user`, a missing one is allowed through anonymously, and
 * an *invalid* one is still rejected. Used where the response is richer for a
 * signed-in user (e.g. the map showing your saved places).
 */
export const IS_OPTIONAL_AUTH_KEY = 'firo:optional_auth';
export const OptionalAuth = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_OPTIONAL_AUTH_KEY, true);

/** Declares the roles allowed to access a route (enforced by RolesGuard). */
export const ROLES_KEY = 'firo:roles';
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

/** Injects the authenticated principal into a handler parameter. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    return request.user;
  },
);
