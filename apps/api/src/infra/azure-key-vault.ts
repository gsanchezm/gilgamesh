import { StubSecretVault, type SecretVault } from '@gilgamesh/application';
import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';

/**
 * Real secret storage behind the frozen {@link SecretVault} port (slice 20, owner decision S20):
 * Azure Key Vault over `SecretClient` + `DefaultAzureCredential` (managed identity in prod,
 * `az login`/service-principal env locally). The SDK client is an injected seam
 * ({@link KeyVaultSecretsClient}) so unit tests drive a fake and no suite ever touches Azure.
 *
 * The `secretRef` contract is UNCHANGED from the stub: `put(scope)` returns `vault://<scope>`
 * (scope = `<orgId>/<integration key>`, built by ConnectIntegration and parsed back by the BYOK
 * resolver) — stub-written rows resolve against the real vault and vice versa. Key Vault secret
 * NAMES only allow `[0-9a-zA-Z-]`, so {@link encodeVaultSecretName} maps the scope
 * deterministically AND injectively (see its doc — a collision would cross-write tenants).
 *
 * Secret values are treated per the S17 scrub rule: any client failure propagates as a fresh
 * {@link KeyVaultError} with the value `[redacted]` and NO `cause` chaining; the adapter never logs.
 */

const REDACTED = '[redacted]';
const SECRET_REF_PREFIX = 'vault://';
/** Azure Key Vault secret-name limit (names match `^[0-9a-zA-Z-]{1,127}$`). */
const MAX_SECRET_NAME_LENGTH = 127;

/** The minimal `SecretClient` surface the adapter needs — the unit-test seam. */
export interface KeyVaultSecretsClient {
  setSecret(name: string, value: string): Promise<unknown>;
  getSecret(name: string): Promise<{ value?: string }>;
}

/** A failed vault operation. NEVER constructed with `cause` — chaining the original SDK error
 *  would smuggle its unscrubbed message into any logger that serializes error chains (S17 rule). */
export class KeyVaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyVaultError';
  }
}

function scrub(message: string, secrets: string[]): string {
  let out = message;
  for (const secret of secrets) if (secret) out = out.split(secret).join(REDACTED);
  return out;
}

/** Azure's not-found shapes: a REST 404 and/or the `SecretNotFound` error code. */
function isNotFound(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const { statusCode, code } = e as { statusCode?: unknown; code?: unknown };
  return statusCode === 404 || code === 'SecretNotFound';
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Deterministic, INJECTIVE scope → Key Vault secret-name mapping. `[0-9a-zA-Z]` pass through
 * verbatim; every other character (including `-` and `/`) is escaped as `-hh` per UTF-8 byte
 * (two lowercase hex digits): `-`→`-2d`, `/`→`-2f`, `_`→`-5f`. Escapes are the only source of
 * `-` in the output and each is exactly `-hh`, so the encoding is reversible — two distinct
 * scopes can never collide into one secret name (which would cross-write tenants' secrets).
 *
 * Example: `f81d4fae-…6bf6/anthropic` → `f81d4fae-2d…6bf6-2fanthropic`.
 *
 * Throws {@link KeyVaultError} when the result is empty or exceeds Key Vault's 127-char limit;
 * the message names the SCOPE only (`<orgId>/<key>` — never secret material).
 */
export function encodeVaultSecretName(scope: string): string {
  let name = '';
  for (const ch of scope) {
    if (/[0-9a-zA-Z]/.test(ch)) name += ch;
    else for (const byte of Buffer.from(ch, 'utf8')) name += `-${byte.toString(16).padStart(2, '0')}`;
  }
  if (name.length === 0 || name.length > MAX_SECRET_NAME_LENGTH) {
    throw new KeyVaultError(
      `Vault scope "${scope}" maps to an invalid Key Vault secret name (empty or longer than ${MAX_SECRET_NAME_LENGTH} chars).`,
    );
  }
  return name;
}

export class AzureKeyVaultSecretVault implements SecretVault {
  constructor(private readonly client: KeyVaultSecretsClient) {}

  async put(scope: string, secret: string): Promise<string> {
    // Encoded OUTSIDE the try: a mapping error names the scope and carries no secret.
    const name = encodeVaultSecretName(scope);
    try {
      await this.client.setSecret(name, secret);
    } catch (e) {
      throw new KeyVaultError(scrub(`Key Vault setSecret "${name}" failed: ${messageOf(e)}`, [secret]));
    }
    return `${SECRET_REF_PREFIX}${scope}`;
  }

  async get(scope: string): Promise<string | null> {
    const name = encodeVaultSecretName(scope);
    try {
      const secret = await this.client.getSecret(name);
      return secret.value ?? null;
    } catch (e) {
      if (isNotFound(e)) return null; // a missing secret is the port's null, never a throw
      // No secret value is in hand on the read path; still a FRESH error, no `cause` chaining.
      throw new KeyVaultError(`Key Vault getSecret "${name}" failed: ${messageOf(e)}`);
    }
  }
}

/**
 * Provider selection (slice 20) — the S17 `emailFromEnv` idiom with the S15 security INVERSION
 * (decisions log, stream D): explicit `VAULT_MODE=offline` → the slice-6 in-memory stub, REFUSED
 * under `NODE_ENV=production`; `AZURE_KEY_VAULT_URL` set → the real adapter; anything else is a
 * BOOT ERROR. Unlike the brain/email/payments stubs, a silently selected secret-vault stub would
 * hold live BYOK keys in process memory (lost on restart, invisible to rotation) — missing config
 * must never degrade to that, so the selector throws instead of falling back.
 */
export type VaultMode = 'offline' | 'azure';

export function resolveVaultMode(env: NodeJS.ProcessEnv = process.env): VaultMode {
  if (env.VAULT_MODE === 'offline') {
    if (env.NODE_ENV === 'production') {
      throw new KeyVaultError(
        'VAULT_MODE=offline is refused under NODE_ENV=production — the in-memory secret-vault stub ' +
          'must never hold production secrets. Set AZURE_KEY_VAULT_URL to a real Key Vault.',
      );
    }
    return 'offline';
  }
  if (env.AZURE_KEY_VAULT_URL?.trim()) return 'azure';
  throw new KeyVaultError(
    'SecretVault is unconfigured: set AZURE_KEY_VAULT_URL to your Key Vault URI, or explicitly opt ' +
      'in to the in-memory stub with VAULT_MODE=offline (dev/test only). Missing config never falls ' +
      'back to the stub — secrets would silently live in process memory.',
  );
}

/**
 * The wiring entry point (the `brainFromEnv`/`emailFromEnv` idiom): resolves the mode from env —
 * throwing the §0 boot error when unconfigured — and builds the stub or the Azure adapter.
 * `makeClient` is injectable so tests never touch the Azure SDK; the default builds the real
 * `SecretClient` with `DefaultAzureCredential` (no network until the first call).
 */
export function vaultFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  makeClient: (vaultUrl: string) => KeyVaultSecretsClient = (vaultUrl) =>
    new SecretClient(vaultUrl, new DefaultAzureCredential()),
): SecretVault {
  if (resolveVaultMode(env) === 'offline') return new StubSecretVault();
  return new AzureKeyVaultSecretVault(makeClient(env.AZURE_KEY_VAULT_URL!.trim()));
}
