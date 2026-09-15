/**
 * Every state-changing action taken from the admin console is recorded here.
 *
 * This is not bureaucracy. The console lets a human rewrite published content
 * and change another account's roles from a web page; without a log, "the
 * summary is wrong and nobody knows who changed it" is unanswerable, and a
 * stolen admin session leaves no trace at all.
 *
 * `before`/`after` hold the affected row on either side of the change, so the
 * log doubles as a one-step undo source without a full temporal table.
 */
export interface AuditEntry {
  readonly actorId: string;
  readonly actorHandle: string;
  /** Dotted verb: 'experience.updated', 'user.suspended', 'user.roles_changed'. */
  readonly action: string;
  readonly targetType: 'experience' | 'place' | 'user';
  readonly targetId: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly at: string;
}

export interface AuditLog {
  record(entry: AuditEntry): Promise<void>;
  /** Newest first. */
  list(limit: number): Promise<readonly AuditEntry[]>;
  listForTarget(
    targetType: AuditEntry['targetType'],
    targetId: string,
    limit: number,
  ): Promise<readonly AuditEntry[]>;
}

export const AUDIT_LOG = Symbol('AUDIT_LOG');
