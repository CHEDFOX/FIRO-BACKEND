import { Role } from '../../domain/role';

/** The authenticated principal attached to a request by JwtAuthGuard. */
export interface AuthenticatedUser {
  readonly userId: string;
  readonly roles: Role[];
  readonly sessionId: string;
}

/** Request shape after authentication (Fastify request + our principal). */
export interface RequestWithUser {
  user?: AuthenticatedUser;
  headers?: Record<string, string | string[] | undefined>;
}
