import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../../../../shared/errors/app-error';
import { Role } from '../../domain/role';
import { RequestWithUser } from './authenticated-user';
import { ROLES_KEY } from './decorators';

/**
 * Enforces @Roles(...) on a route. Runs after JwtAuthGuard, so `request.user`
 * is present. A route with no @Roles metadata is allowed for any authenticated
 * user.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const roles = request.user?.roles ?? [];
    const allowed = required.some((role) => roles.includes(role));
    if (!allowed) {
      throw AppError.forbidden('auth.insufficient_role', 'You do not have access to this resource');
    }
    return true;
  }
}
