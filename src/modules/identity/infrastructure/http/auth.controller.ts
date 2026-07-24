import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AppError } from '../../../../shared/errors/app-error';
import { ZodValidationPipe } from '../../../../shared/http/zod-validation.pipe';
import { PublicAuthResult } from '../../application/auth-result';
import { GetCurrentUserUseCase } from '../../application/get-current-user.usecase';
import { LoginUseCase } from '../../application/login.usecase';
import { RefreshSessionUseCase } from '../../application/refresh-session.usecase';
import { RegisterUserUseCase } from '../../application/register-user.usecase';
import { RevokeSessionUseCase } from '../../application/revoke-session.usecase';
import { PublicUser, toPublicUser } from '../../domain/user';
import { AuthenticatedUser } from './authenticated-user';
import {
  LoginInput,
  LoginSchema,
  LogoutInput,
  LogoutSchema,
  RefreshInput,
  RefreshSchema,
  RegisterInput,
  RegisterSchema,
} from './auth.dto';
import { CurrentUser, Public } from './decorators';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

/**
 * Auth endpoints under /v1/auth. Guards apply at the controller level; the
 * unauthenticated entry points (register/login/refresh) opt out with @Public().
 */
@Controller('auth')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuthController {
  constructor(
    private readonly registerUser: RegisterUserUseCase,
    private readonly login: LoginUseCase,
    private readonly refreshSession: RefreshSessionUseCase,
    private readonly revokeSession: RevokeSessionUseCase,
    private readonly getCurrentUser: GetCurrentUserUseCase,
  ) {}

  @Post('register')
  @Public()
  async register(
    @Body(new ZodValidationPipe(RegisterSchema)) body: RegisterInput,
  ): Promise<PublicAuthResult> {
    const result = await this.registerUser.execute(body);
    return { user: toPublicUser(result.user), tokens: result.tokens };
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  async loginHandler(
    @Body(new ZodValidationPipe(LoginSchema)) body: LoginInput,
  ): Promise<PublicAuthResult> {
    const result = await this.login.execute(body);
    return { user: toPublicUser(result.user), tokens: result.tokens };
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  async refresh(
    @Body(new ZodValidationPipe(RefreshSchema)) body: RefreshInput,
  ): Promise<PublicAuthResult> {
    const result = await this.refreshSession.execute(body);
    return { user: toPublicUser(result.user), tokens: result.tokens };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Body(new ZodValidationPipe(LogoutSchema)) body: LogoutInput,
  ): Promise<{ revoked: true }> {
    await this.revokeSession.execute(body);
    return { revoked: true };
  }

  @Get('me')
  async me(@CurrentUser() principal: AuthenticatedUser | undefined): Promise<PublicUser> {
    if (!principal) {
      throw AppError.unauthenticated();
    }
    const user = await this.getCurrentUser.execute(principal.userId);
    return toPublicUser(user);
  }
}
