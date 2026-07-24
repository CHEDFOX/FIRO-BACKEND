import { Injectable } from '@nestjs/common';
import { AuthResult } from './auth-result';
import { SessionManager } from './session-manager';

export interface RefreshSessionCommand {
  readonly refreshToken: string;
  readonly deviceId?: string;
}

@Injectable()
export class RefreshSessionUseCase {
  constructor(private readonly sessions: SessionManager) {}

  execute(command: RefreshSessionCommand): Promise<AuthResult> {
    return this.sessions.rotate(command.refreshToken, command.deviceId ?? null);
  }
}
