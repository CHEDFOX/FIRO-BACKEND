import { z } from 'zod';

/**
 * Typed, validated application configuration.
 *
 * Environment variables are the only untyped input into the system; we validate
 * them once at startup with zod and fail loudly if anything is missing or
 * malformed. Everything downstream depends on the typed AppConfig, never on
 * process.env directly.
 */

export const APP_CONFIG = Symbol('APP_CONFIG');

export const SERVICE_NAME = 'firo-backend';
export const SERVICE_VERSION = '0.1.0';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  API_BASE_URL: z.string().url().default('http://localhost:3000'),

  /**
   * Comma-separated list of browser origins allowed to call the API, or "*"
   * for any. Browsers block cross-origin calls without this, so any web client
   * needs its origin listed. Keep it explicit in production.
   */
  CORS_ORIGINS: z.string().default('*'),

  // --- Database ---
  // Unset means in-memory storage: the app still boots and every endpoint
  // works, but nothing survives a restart. Tests rely on this.
  DATABASE_URL: z.string().min(1).optional(),
  DB_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),
  DB_AUTO_MIGRATE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  // --- Auth / JWT ---
  // NOTE: HS256 with a shared secret for the foundation phase. The production
  // target (ADR-0007 in platform docs) is asymmetric EdDSA with a published
  // JWKS; the TokenIssuer port makes that swap isolated to infrastructure.
  JWT_SECRET: z.string().min(16).default('dev-insecure-secret-change-me-please'),
  JWT_ISSUER: z.string().default('firo.auth'),
  JWT_AUDIENCE: z.string().default('firo.api'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900), // 15m
  JWT_REFRESH_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30), // 30d

  // --- Admin console ---
  /**
   * Comma-separated emails that receive the admin role when they register.
   *
   * This is a bootstrap, not an access-control system: it only applies at sign
   * up, so it cannot promote an existing account, and the list must contain
   * addresses you already control. Everything after the first admin is done
   * from the console itself (audited), or with `pnpm admin:grant`.
   */
  ADMIN_EMAILS: z.string().default(''),

  // --- Media ---
  /** Where uploaded images live. In Docker this is a mounted volume. */
  MEDIA_DIR: z.string().min(1).default('./var/media'),
  /**
   * Public prefix images are served from. Empty means "this API, at /media",
   * which is the development default; in production nginx serves the same
   * paths and this points at the real host (or a CDN in front of it).
   */
  MEDIA_BASE_URL: z.string().default(''),
  /** Per-file upload cap. Every byte here is bandwidth on every view. */
  MEDIA_MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(25 * 1024 * 1024), // 25 MB
  /**
   * Uploads stop below this much free disk.
   *
   * Images share a volume with Postgres on a single VPS, so a disk filled by a
   * bulk upload is not a failed upload — it is a database that cannot write.
   */
  MEDIA_MIN_FREE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(2 * 1024 * 1024 * 1024), // 2 GB
});

export type Env = z.infer<typeof envSchema>;

export interface AppConfig extends Env {
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly isProduction: boolean;
  /** Parsed CORS_ORIGINS: either "*" or an explicit list of origins. */
  readonly corsOrigins: '*' | string[];
  /** Parsed ADMIN_EMAILS, lowercased. Empty means "no bootstrap admin". */
  readonly adminEmails: readonly string[];
  /** MEDIA_BASE_URL, or this API's own /media route when unset. */
  readonly mediaBaseUrl: string;
}

function parseCorsOrigins(raw: string): '*' | string[] {
  const trimmed = raw.trim();
  if (trimmed === '*' || trimmed === '') {
    return '*';
  }
  return trimmed
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return {
    ...parsed.data,
    serviceName: SERVICE_NAME,
    serviceVersion: SERVICE_VERSION,
    isProduction: parsed.data.NODE_ENV === 'production',
    corsOrigins: parseCorsOrigins(parsed.data.CORS_ORIGINS),
    adminEmails: parseAdminEmails(parsed.data.ADMIN_EMAILS),
    mediaBaseUrl:
      parsed.data.MEDIA_BASE_URL.trim().replace(/\/+$/, '') ||
      `${parsed.data.API_BASE_URL.replace(/\/+$/, '')}/media`,
  };
}

function parseAdminEmails(raw: string): string[] {
  return raw
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}
