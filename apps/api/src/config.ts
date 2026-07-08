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
  /** Redis connection URL — backs the rate-limit and SSO-state stores. Absent = both fall back
   *  to their in-memory adapters, which is correct ONLY single-replica (spec staging-deploy §2:
   *  this and the platform's max-replica count must change together). */
  redisUrl?: string;
  /** Allowlisted browser origins for CORS (empty = same-origin only). */
  corsOrigins: string[];
  /** Express `trust proxy` hop count. The real client IP (used as a rate-limit key) is only
   *  correct when this matches the number of appending proxies in front of the API. */
  trustProxy: number;
  /** Absolute path of the built SPA (vite dist). Absent = the API serves no static web (default). */
  webDistDir?: string;
  /** Grace period (ms) between SIGTERM (readiness flips to draining/503) and `app.close()`. Gives
   *  in-flight requests time to finish and ACA's Readiness probe time to observe `not-ready` and stop
   *  routing new traffic. Must exceed ACA's Readiness `periodSeconds × failureThreshold` yet stay
   *  under the container termination grace (~30s) so we close before SIGKILL. Default 10s. */
  shutdownGraceMs: number;
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

  // Optional since the staging deploy (spec staging-deploy §2): the consuming modules select
  // their in-memory adapters when absent; main.ts warns loudly in production.
  const redisUrl = env.REDIS_URL?.trim() || undefined;

  const port = Number(env.API_PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Config error: API_PORT must be a port number 1-65535 (got "${env.API_PORT}").`);
  }

  const corsOrigins = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const trustProxy = Number(env.TRUST_PROXY ?? 1);
  if (!Number.isInteger(trustProxy) || trustProxy < 0) {
    throw new Error(`Config error: TRUST_PROXY must be a non-negative integer (got "${env.TRUST_PROXY}").`);
  }

  // No existence validation here — that belongs to configureWebDist (fail-fast at wire-up), so
  // loadConfig stays a pure env parser.
  const webDistDir = env.WEB_DIST_DIR?.trim() || undefined;

  const shutdownGraceMs = Number(env.SHUTDOWN_GRACE_MS ?? 10_000);
  if (!Number.isInteger(shutdownGraceMs) || shutdownGraceMs < 0) {
    throw new Error(
      `Config error: SHUTDOWN_GRACE_MS must be a non-negative integer (got "${env.SHUTDOWN_GRACE_MS}").`,
    );
  }

  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    port,
    databaseUrl,
    redisUrl,
    corsOrigins,
    trustProxy,
    webDistDir,
    shutdownGraceMs,
    rateLimit: rateLimitFromEnv(env),
  };
}
