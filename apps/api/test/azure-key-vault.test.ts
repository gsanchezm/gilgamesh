import { StubSecretVault } from '@gilgamesh/application';
import { describe, expect, it, vi } from 'vitest';
import {
  AzureKeyVaultSecretVault,
  encodeVaultSecretName,
  KeyVaultError,
  resolveVaultMode,
  vaultFromEnv,
  type KeyVaultSecretsClient,
} from '../src/infra/azure-key-vault';

const env = (over: Record<string, string> = {}) => ({ ...over }) as NodeJS.ProcessEnv;

const VAULT_URL = 'https://gilgamesh-vault.vault.azure.net';
const ORG_ID = 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6';

/** Map-backed fake of the injected SDK seam. `getSecret` throws Azure-style on a missing name. */
function fakeClient(): KeyVaultSecretsClient & {
  setSecret: ReturnType<typeof vi.fn>;
  getSecret: ReturnType<typeof vi.fn>;
} {
  const store = new Map<string, string>();
  return {
    setSecret: vi.fn(async (name: string, value: string) => {
      store.set(name, value);
      return { name, value };
    }),
    getSecret: vi.fn(async (name: string) => {
      if (!store.has(name)) {
        throw Object.assign(new Error(`A secret with (name/id) ${name} was not found in this key vault.`), {
          statusCode: 404,
          code: 'SecretNotFound',
        });
      }
      return { name, value: store.get(name)! };
    }),
  };
}

describe('provider selection — security inversion (AC-VAULT-01/02/03)', () => {
  it('resolveVaultMode: explicit VAULT_MODE=offline wins, even when the vault URL is also set', () => {
    expect(resolveVaultMode(env({ VAULT_MODE: 'offline' }))).toBe('offline');
    expect(resolveVaultMode(env({ VAULT_MODE: 'offline', AZURE_KEY_VAULT_URL: VAULT_URL }))).toBe('offline');
  });

  it('resolveVaultMode: AZURE_KEY_VAULT_URL selects azure', () => {
    expect(resolveVaultMode(env({ AZURE_KEY_VAULT_URL: VAULT_URL }))).toBe('azure');
  });

  it('resolveVaultMode: unconfigured is a boot error naming both variables — never a silent stub', () => {
    for (const e of [env(), env({ AZURE_KEY_VAULT_URL: '   ' }), env({ VAULT_MODE: 'auto' })]) {
      expect(() => resolveVaultMode(e)).toThrowError(KeyVaultError);
      expect(() => resolveVaultMode(e)).toThrowError(/AZURE_KEY_VAULT_URL/);
      expect(() => resolveVaultMode(e)).toThrowError(/VAULT_MODE=offline/);
    }
  });

  it('resolveVaultMode: the offline stub refuses NODE_ENV=production (belt and braces)', () => {
    const e = env({ VAULT_MODE: 'offline', NODE_ENV: 'production' });
    expect(() => resolveVaultMode(e)).toThrowError(KeyVaultError);
    expect(() => resolveVaultMode(e)).toThrowError(/NODE_ENV=production/);
  });

  it('offline mode: vaultFromEnv returns the StubSecretVault and never builds a client', async () => {
    const makeClient = vi.fn(() => fakeClient());
    const vault = vaultFromEnv(env({ VAULT_MODE: 'offline', AZURE_KEY_VAULT_URL: VAULT_URL }), makeClient);
    expect(vault).toBeInstanceOf(StubSecretVault);
    await expect(vault.put(`${ORG_ID}/anthropic`, 'sk-ant-x')).resolves.toBe(`vault://${ORG_ID}/anthropic`);
    expect(makeClient).not.toHaveBeenCalled();
  });

  it('azure mode: vaultFromEnv builds the client from the trimmed URL and returns the real adapter', () => {
    const makeClient = vi.fn(() => fakeClient());
    const vault = vaultFromEnv(env({ AZURE_KEY_VAULT_URL: `  ${VAULT_URL}  ` }), makeClient);
    expect(vault).toBeInstanceOf(AzureKeyVaultSecretVault);
    expect(makeClient).toHaveBeenCalledWith(VAULT_URL);
  });

  it('unconfigured: vaultFromEnv throws before any client could be built', () => {
    const makeClient = vi.fn(() => fakeClient());
    expect(() => vaultFromEnv(env(), makeClient)).toThrowError(KeyVaultError);
    expect(makeClient).not.toHaveBeenCalled();
  });
});

describe('scope → secret-name mapping (AC-VAULT-04)', () => {
  it('encodes the canonical <orgId>/<key> scope: alnum verbatim, "-"→-2d, "/"→-2f', () => {
    expect(encodeVaultSecretName(`${ORG_ID}/anthropic`)).toBe(
      'f81d4fae-2d7dec-2d11d0-2da765-2d00a0c91e6bf6-2fanthropic',
    );
  });

  it('encodes "_" (ado_repos, the one catalog key outside [a-z]) as -5f', () => {
    expect(encodeVaultSecretName('ado_repos')).toBe('ado-5frepos');
  });

  it('only ever emits Key Vault-legal characters', () => {
    expect(encodeVaultSecretName(`${ORG_ID}/ado_repos`)).toMatch(/^[0-9a-zA-Z-]+$/);
  });

  it('is injective where naive dash-collapsing would collide', () => {
    const names = ['a/b', 'a-b', 'a_b', 'a--b', 'ab'].map(encodeVaultSecretName);
    expect(new Set(names).size).toBe(names.length);
  });

  it('escapes non-ASCII characters per UTF-8 byte', () => {
    expect(encodeVaultSecretName('é')).toBe('-c3-a9');
  });

  it('rejects an empty scope and a scope encoding past 127 chars, without KeyVaultError leaking anything but the scope', () => {
    expect(() => encodeVaultSecretName('')).toThrowError(KeyVaultError);
    expect(() => encodeVaultSecretName('/'.repeat(50))).toThrowError(KeyVaultError); // 150 encoded chars
  });
});

describe('put/get round-trip (AC-VAULT-04)', () => {
  it('put stores under the encoded name and returns the stub-identical vault://<scope> ref', async () => {
    const client = fakeClient();
    const vault = new AzureKeyVaultSecretVault(client);
    const ref = await vault.put(`${ORG_ID}/anthropic`, 'sk-ant-live-123');
    expect(ref).toBe(`vault://${ORG_ID}/anthropic`);
    expect(client.setSecret).toHaveBeenCalledWith(
      'f81d4fae-2d7dec-2d11d0-2da765-2d00a0c91e6bf6-2fanthropic',
      'sk-ant-live-123',
    );
  });

  it('get resolves through the same encoding and returns the stored value', async () => {
    const client = fakeClient();
    const vault = new AzureKeyVaultSecretVault(client);
    await vault.put(`${ORG_ID}/github`, 'ghp_token');
    await expect(vault.get(`${ORG_ID}/github`)).resolves.toBe('ghp_token');
    expect(client.getSecret).toHaveBeenCalledWith('f81d4fae-2d7dec-2d11d0-2da765-2d00a0c91e6bf6-2fgithub');
  });

  it('get maps a missing secret (Azure 404 / SecretNotFound) to null, never a throw', async () => {
    const vault = new AzureKeyVaultSecretVault(fakeClient());
    await expect(vault.get(`${ORG_ID}/anthropic`)).resolves.toBeNull();
  });

  it('get also honors a bare statusCode 404 without the SecretNotFound code', async () => {
    const client = fakeClient();
    client.getSecret.mockRejectedValueOnce(Object.assign(new Error('not found'), { statusCode: 404 }));
    const vault = new AzureKeyVaultSecretVault(client);
    await expect(vault.get(`${ORG_ID}/anthropic`)).resolves.toBeNull();
  });
});

describe('secret-value scrubbing (AC-VAULT-05)', () => {
  it('a put failure surfaces as KeyVaultError with the secret value redacted and no cause', async () => {
    const client = fakeClient();
    client.setSecret.mockRejectedValueOnce(
      new Error('Request failed: payload {"value":"sk-ant-super-secret"} rejected by policy'),
    );
    const vault = new AzureKeyVaultSecretVault(client);

    const err = await vault.put(`${ORG_ID}/anthropic`, 'sk-ant-super-secret').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KeyVaultError);
    const { message, cause } = err as KeyVaultError;
    expect(message).not.toContain('sk-ant-super-secret');
    expect(message).toContain('[redacted]');
    expect(message).toContain('rejected by policy'); // the diagnostic remains useful
    expect(cause).toBeUndefined(); // chaining would smuggle the unscrubbed original into logs
  });

  it('non-Error client rejections are stringified and scrubbed the same way', async () => {
    const client = fakeClient();
    client.setSecret.mockRejectedValueOnce(`string failure echoing hunter2`); // eslint-disable-line no-throw-literal
    const vault = new AzureKeyVaultSecretVault(client);
    const err = await vault.put(`${ORG_ID}/github`, 'hunter2').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KeyVaultError);
    expect((err as KeyVaultError).message).not.toContain('hunter2');
    expect((err as KeyVaultError).message).toContain('[redacted]');
  });

  it('a non-404 get failure surfaces as a fresh KeyVaultError (no cause), not null', async () => {
    const client = fakeClient();
    client.getSecret.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { statusCode: 403 }));
    const vault = new AzureKeyVaultSecretVault(client);
    const err = await vault.get(`${ORG_ID}/anthropic`).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KeyVaultError);
    expect((err as KeyVaultError).message).toContain('Forbidden');
    expect((err as KeyVaultError).cause).toBeUndefined();
  });
});
