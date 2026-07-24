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
});

export type Env = z.infer<typeof envSchema>;

export interface AppConfig extends Env {
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly isProduction: boolean;
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
  };
}
