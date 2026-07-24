import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role } from '../../domain/role';
import { AuthenticatedUser, RequestWithUser } from './authenticated-user';

/** Marks a route as public — JwtAuthGuard skips authentication. */
export const IS_PUBLIC_KEY = 'firo:is_public';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

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
