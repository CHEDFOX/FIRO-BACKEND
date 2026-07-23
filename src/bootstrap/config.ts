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
