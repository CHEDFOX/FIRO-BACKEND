import { Injectable } from '@nestjs/common';
import { SessionManager } from './session-manager';

export interface RevokeSessionCommand {
  readonly refreshToken: string;
}

/** Logout: revoke the entire session family the refresh token belongs to. */
@Injectable()
export class RevokeSessionUseCase {
  constructor(private readonly sessions: SessionManager) {}

  execute(command: RevokeSessionCommand): Promise<void> {
    return this.sessions.revoke(command.refreshToken);
  }
}
