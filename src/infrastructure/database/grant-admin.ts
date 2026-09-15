import 'reflect-metadata';
import { loadConfig } from '../../bootstrap/config';
import { Database } from './database';

/**
 * Grants or revokes the admin role on an existing account.
 *
 *   pnpm admin:grant you@example.com
 *   pnpm admin:grant you@example.com --revoke
 *
 * Deliberately a shell command on the server, not an API route: the ability to
 * mint the first administrator must require access to the machine, otherwise
 * it is an escalation path. Every promotion made *after* the first goes
 * through the console and lands in the audit log.
 */
async function main(): Promise<void> {
  const [email, ...flags] = process.argv.slice(2);
  const revoke = flags.includes('--revoke');

  if (!email) {
    throw new Error('Usage: pnpm admin:grant <email> [--revoke]');
  }

  const config = loadConfig();
  if (!config.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set. Without a database, accounts live in memory and ' +
        'this command has nothing to change — use ADMIN_EMAILS instead.',
    );
  }

  const db = new Database({
    connectionString: config.DATABASE_URL,
    isProduction: config.isProduction,
  });

  try {
    const rows = await db.query<{ handle: string; roles: string[] }>(
      revoke
        ? `UPDATE identity.users
              SET roles = array_remove(roles, 'admin'),
                  updated_at = now(),
                  version = version + 1
            WHERE email = $1
            RETURNING handle::text, roles`
        : `UPDATE identity.users
              SET roles = (
                    SELECT array_agg(DISTINCT role ORDER BY role)
                    FROM unnest(roles || ARRAY['admin']) AS role
                  ),
                  updated_at = now(),
                  version = version + 1
            WHERE email = $1
            RETURNING handle::text, roles`,
      [email.trim().toLowerCase()],
    );

    const row = rows[0];
    if (!row) {
      throw new Error(`No account with email "${email}". Register it first, then re-run this.`);
    }

    console.log(
      `${revoke ? 'revoked admin from' : 'granted admin to'} @${row.handle} — roles are now [${row.roles.join(', ')}]`,
    );
    console.log('Existing access tokens keep their old roles until they expire (15 minutes).');
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
