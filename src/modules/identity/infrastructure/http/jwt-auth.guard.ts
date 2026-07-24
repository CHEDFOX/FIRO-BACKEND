import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../../../../shared/errors/app-error';
import { TOKEN_ISSUER, TokenIssuer } from '../../domain/token-issuer';
import { RequestWithUser } from './authenticated-user';
import { IS_PUBLIC_KEY } from './decorators';

/**
 * Authenticates requests via a Bearer access token and attaches the principal
 * to `request.user`. Routes marked @Public() bypass authentication.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_ISSUER) private readonly tokenIssuer: TokenIssuer,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractBearer(request.headers?.['authorization']);
    if (!token) {
      throw AppError.unauthenticated('auth.missing_token', 'Missing bearer token');
    }

    request.user = await this.tokenIssuer.verifyAccessToken(token);
    return true;
  }

  private extractBearer(header: string | string[] | undefined): string | null {
    const value = Array.isArray(header) ? header[0] : header;
    if (!value) {
      return null;
    }
    const [scheme, token] = value.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      return null;
    }
    return token;
  }
}
