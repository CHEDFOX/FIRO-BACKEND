import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, Database } from '../../../../infrastructure/database/database';
import type { AuditEntry, AuditLog } from '../../domain/audit-log';

@Injectable()
export class PostgresAuditLog implements AuditLog {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.db.query(
      `INSERT INTO admin.audit_log
         (actor_id, actor_handle, action, target_type, target_id, before, after, at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        entry.actorId,
        entry.actorHandle,
        entry.action,
        entry.targetType,
        entry.targetId,
        entry.before === undefined ? null : JSON.stringify(entry.before),
        entry.after === undefined ? null : JSON.stringify(entry.after),
        entry.at,
      ],
    );
  }

  async list(limit: number): Promise<readonly AuditEntry[]> {
    const rows = await this.db.query<AuditRow>(
      `SELECT actor_id, actor_handle, action, target_type, target_id, before, after, at
       FROM admin.audit_log ORDER BY at DESC LIMIT $1`,
      [limit],
    );
    return rows.map(toEntry);
  }

  async listForTarget(
    targetType: AuditEntry['targetType'],
    targetId: string,
    limit: number,
  ): Promise<readonly AuditEntry[]> {
    const rows = await this.db.query<AuditRow>(
      `SELECT actor_id, actor_handle, action, target_type, target_id, before, after, at
       FROM admin.audit_log
       WHERE target_type = $1 AND target_id = $2
       ORDER BY at DESC LIMIT $3`,
      [targetType, targetId, limit],
    );
    return rows.map(toEntry);
  }
}

interface AuditRow {
  actor_id: string;
  actor_handle: string;
  action: string;
  target_type: string;
  target_id: string | null;
  before: unknown;
  after: unknown;
  at: Date;
}

function toEntry(row: AuditRow): AuditEntry {
  return {
    actorId: row.actor_id,
    actorHandle: row.actor_handle,
    action: row.action,
    targetType: row.target_type as AuditEntry['targetType'],
    targetId: row.target_id,
    before: row.before,
    after: row.after,
    at: row.at.toISOString(),
  };
}

/**
 * In-memory audit log — a bounded ring so a long-running dev process cannot
 * grow without limit. Losing it on restart is acceptable *only* because
 * in-memory mode loses the edits it describes at the same moment.
 */
@Injectable()
export class InMemoryAuditLog implements AuditLog {
  private static readonly CAPACITY = 500;
  private readonly entries: AuditEntry[] = [];

  async record(entry: AuditEntry): Promise<void> {
    this.entries.unshift(entry);
    if (this.entries.length > InMemoryAuditLog.CAPACITY) {
      this.entries.length = InMemoryAuditLog.CAPACITY;
    }
  }

  async list(limit: number): Promise<readonly AuditEntry[]> {
    return this.entries.slice(0, limit);
  }

  async listForTarget(
    targetType: AuditEntry['targetType'],
    targetId: string,
    limit: number,
  ): Promise<readonly AuditEntry[]> {
    return this.entries
      .filter((entry) => entry.targetType === targetType && entry.targetId === targetId)
      .slice(0, limit);
  }
}
