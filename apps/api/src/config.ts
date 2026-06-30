/**
 * Validated runtime configuration. Fails fast at boot if required env vars are missing or
 * malformed, so a misconfigured server never starts in a half-broken state.
 */
export interface RateLimitConfig {
  /** Max requests per window per (auth-path + IP + email) key. */
  limit: number;
  windowMs: number;
}

export interface ApiConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  /** Allowlisted browser origins for CORS (empty = same-origin only). */
  corsOrigins: string[];
  rateLimit: RateLimitConfig;
}

/**
 * Auth rate-limit knobs. Standalone (no DATABASE_URL dependency) so it can be resolved by the
 * RateLimitGuard provider even in the Docker-free in-memory app. Realistic prod default; tests
 * push it sky-high via env (cucumber.cjs / vitest) so sweeps don't trip it.
 */
export function rateLimitFromEnv(env: NodeJS.ProcessEnv = process.env): RateLimitConfig {
  const limit = Number(env.AUTH_RATE_LIMIT ?? 10);
  const windowMs = Number(env.AUTH_RATE_WINDOW_MS ?? 60_000);
  return {
    limit: Number.isInteger(limit) && limit > 0 ? limit : 10,
    windowMs: Number.isInteger(windowMs) && windowMs > 0 ? windowMs : 60_000,
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('Config error: DATABASE_URL is required.');
  }

  const port = Number(env.API_PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Config error: API_PORT must be a port number 1-65535 (got "${env.API_PORT}").`);
  }

  const corsOrigins = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    port,
    databaseUrl,
    corsOrigins,
    rateLimit: rateLimitFromEnv(env),
  };
}
