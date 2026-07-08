/**
 * Slice 31 — bounded, absent-only Prisma connection posture.
 *
 * Azure Postgres Flexible B1ms has a LOW `max_connections` (~35, minus reserved), and staging
 * scales to zero. Prisma sizes its connection pool + timeouts from DATABASE_URL query params
 * (`connection_limit`, `pool_timeout`, `connect_timeout`) — so the clean, dependency-free posture is
 * to APPEND sane defaults to the connection string when the operator hasn't set them, and hand the
 * augmented URL to the client via the runtime `datasourceUrl` override.
 *
 * Everything here is pure + framework-free so it is exhaustively unit-testable; it is applied once
 * in PrismaService's constructor (the repo's `*FromEnv` infra idiom).
 */

export interface PoolDefaults {
  /** Prisma `connection_limit` — max pooled connections this replica opens. */
  connectionLimit: number;
  /** Prisma `pool_timeout` (SECONDS) — how long a query waits for a free pooled connection. */
  poolTimeoutS: number;
  /** Prisma `connect_timeout` (SECONDS) — how long the first TCP + auth handshake may take. */
  connectTimeoutS: number;
}

/**
 * Conservative defaults for a single small replica against a low-`max_connections` server.
 * `connection_limit=5` leaves ample headroom under B1ms's ~35 budget even when an old + new ACA
 * revision briefly overlap during a rolling update (plus `prisma migrate`'s own boot connection);
 * `pool_timeout`/`connect_timeout=10s` absorb a scale-to-zero cold wake without hanging forever.
 */
export const DEFAULT_POOL_DEFAULTS: PoolDefaults = {
  connectionLimit: 5,
  poolTimeoutS: 10,
  connectTimeoutS: 10,
};

/** Prisma accepts both scheme spellings; anything else is left untouched. */
const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

function positiveIntOr(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Resolve the pool defaults from env — each param independently overridable, sane fallback
 * otherwise. A non-integer / non-positive override is ignored (falls back to the default) so a
 * fat-fingered env var can never degrade the posture below something safe.
 */
export function poolDefaultsFromEnv(env: NodeJS.ProcessEnv = process.env): PoolDefaults {
  return {
    connectionLimit: positiveIntOr(env.DB_CONNECTION_LIMIT, DEFAULT_POOL_DEFAULTS.connectionLimit),
    poolTimeoutS: positiveIntOr(env.DB_POOL_TIMEOUT_S, DEFAULT_POOL_DEFAULTS.poolTimeoutS),
    connectTimeoutS: positiveIntOr(env.DB_CONNECT_TIMEOUT_S, DEFAULT_POOL_DEFAULTS.connectTimeoutS),
  };
}

function setIfAbsent(params: URLSearchParams, name: string, value: string): void {
  // Absent-only: an operator-set value in the URL is authoritative and never overridden.
  if (!params.has(name)) params.set(name, value);
}

/**
 * Return `url` with `connection_limit` / `pool_timeout` / `connect_timeout` set to `opts` ONLY
 * where each is absent — an operator-set value in the URL is never overridden. A falsy,
 * non-postgres, or malformed URL is returned UNCHANGED and never throws: a bad URL must not break
 * boot (Prisma will surface its own connect error clearly if the URL is genuinely unusable).
 */
export function withPoolDefaults(
  url: string | undefined,
  opts: PoolDefaults = DEFAULT_POOL_DEFAULTS,
): string | undefined {
  if (!url) return url;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url; // malformed — leave it, don't break boot
  }
  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) return url; // non-postgres — leave untouched

  const params = parsed.searchParams;
  setIfAbsent(params, 'connection_limit', String(opts.connectionLimit));
  setIfAbsent(params, 'pool_timeout', String(opts.poolTimeoutS));
  setIfAbsent(params, 'connect_timeout', String(opts.connectTimeoutS));
  return parsed.toString();
}

/** Options for {@link connectWithRetry}; all defaulted, `sleep` injectable for deterministic tests. */
export interface ConnectRetryOptions {
  /** Extra attempts after the first (default 2 → up to 3 total). */
  retries?: number;
  /** Base linear backoff between attempts, ms (default 500 → waits 500ms, then 1000ms). */
  backoffMs?: number;
  /** Injectable sleep so tests don't wait real time. */
  sleep?: (ms: number) => Promise<void>;
  /** Detail-free per-attempt notice. NEVER receives the error — a Prisma connect error can embed the DSN. */
  onRetry?: (attempt: number, delayMs: number) => void;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Call `connect`; on failure retry up to `retries` times with linear backoff. Defense-in-depth for
 * a scale-to-zero cold wake, where the first handshake can race Postgres coming up. On EXHAUSTION
 * the last error is rethrown UNMODIFIED so Prisma's own connect failure surfaces clearly at boot —
 * never swallowed. Retry notices are detail-free by design (the error may carry credentials).
 */
export async function connectWithRetry(
  connect: () => Promise<void>,
  { retries = 2, backoffMs = 500, sleep = defaultSleep, onRetry }: ConnectRetryOptions = {},
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await connect();
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const delayMs = backoffMs * (attempt + 1);
        onRetry?.(attempt + 1, delayMs);
        await sleep(delayMs);
      }
    }
  }
  throw lastErr;
}
