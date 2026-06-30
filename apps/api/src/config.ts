/**
 * Validated runtime configuration. Fails fast at boot if required env vars are missing or
 * malformed, so a misconfigured server never starts in a half-broken state.
 */
export interface ApiConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  /** Allowlisted browser origins for CORS (empty = same-origin only). */
  corsOrigins: string[];
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

  return { nodeEnv: env.NODE_ENV ?? 'development', port, databaseUrl, corsOrigins };
}
