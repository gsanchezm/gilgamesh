# Slice 20 — Real SecretVault adapter (Azure Key Vault) (SDD Spec)

> Spec-Driven-Design spec for slice 20 of Gilgamesh — a SMALL, infra-only adapter slice.
> Authority order: **Keystone** (`specs/_keystone/foundation-vocabulary.md`, **v0.6** — the §5-adjacent
> `SecretVault` application port [slice 6, S9 added `get`] and the §2 `Integration.secretRef`
> ("Key Vault ref — NEVER raw token") stay **frozen verbatim**; nothing keystone changes) →
> **Decisions log** ("Programa paralelo v3", stream D: security inversion, S15 pattern) →
> **Slice-6 spec** (`specs/slices/06-integrations/spec.md`, whose `StubSecretVault` deferral
> "a real vault (KMS/Key Vault) drops in behind the same port" this slice closes).
> v0.1 — 2026-07-06. Status: APPROVED FOR TDD. Branch `feat-secret-vault`.

---

## 0. Owner decision S20

**Real secret storage = Azure Key Vault** (`AzureKeyVaultSecretVault`) behind the frozen
`SecretVault` port (`packages/application/src/ports/integrations.ts`) — the platform already
deploys to Azure Container Apps (`infra/bicep/`), so `@azure/keyvault-secrets` +
`@azure/identity` (`DefaultAzureCredential`: managed identity in prod, developer credential
locally) is the native fit. **Selection is env-driven** (`vaultFromEnv()`, the S17
`emailFromEnv` idiom) **with the S15 security INVERSION** (decisions log, stream D):

- explicit `VAULT_MODE=offline` → the slice-6 `StubSecretVault` (in-process map; every test
  harness pins this) — **refused under `NODE_ENV=production`** (boot error).
- `AZURE_KEY_VAULT_URL` set (and no offline pin) → `AzureKeyVaultSecretVault` over
  `SecretClient(url, DefaultAzureCredential)`.
- **anything else → a clear BOOT ERROR.** Unlike the brain/email/payments stubs, a silently
  selected secret-vault stub in a misconfigured production deployment would hold live BYOK
  API keys in process memory (lost on restart, invisible to rotation, trivially dumped) —
  missing config must never degrade to that. The SSO precedent degrades to an "unavailable"
  route because auth has a graceful fallback; a vault is a hard boot dependency of both
  persistence wirings, so the refusal here is a thrown error at wiring time.

Config env vars:

| Var | Meaning | Default |
|-----|---------|---------|
| `AZURE_KEY_VAULT_URL` | The vault URI, e.g. `https://<name>.vault.azure.net`. Credential = `DefaultAzureCredential` (managed identity / az login / env service principal). | unset → **boot error** unless `VAULT_MODE=offline` |
| `VAULT_MODE` | `offline` = explicit opt-in to the in-memory stub (harness/CI/dev pin). Refused under `NODE_ENV=production`. Any other value = auto (URL required). | auto |

**ALL suites/CI stay offline (stub):** `VAULT_MODE=offline` is pinned in every harness the S9/S17
way (`apps/api/vitest.config.ts`, `vitest.int.config.ts`, `test/setup.ts`, `cucumber.cjs`,
`apps/web/playwright.config.ts`) — no suite ever needs Azure credentials or network. Local dev
runs (`start:dev`) need `VAULT_MODE=offline` in the shell env (documented in `.env.example`).

---

## 1. Scope

### In scope
- `apps/api/src/infra/azure-key-vault.ts` —
  - `AzureKeyVaultSecretVault implements SecretVault` over an **injected client seam**
    (`KeyVaultSecretsClient` = the minimal `setSecret`/`getSecret` surface of the SDK's
    `SecretClient`; unit tests inject a fake, the real factory builds
    `new SecretClient(AZURE_KEY_VAULT_URL, new DefaultAzureCredential())` — no network until
    the first call).
  - `encodeVaultSecretName(scope)` — the deterministic scope→secret-name mapping (§2).
  - `vaultFromEnv()` selector + `resolveVaultMode()` (the `emailFromEnv`/`resolveEmailMode`
    idiom, inverted per §0).
  - **Secret-value scrubbing:** any client failure propagates as a fresh `KeyVaultError`
    whose message has the secret VALUE replaced with `[redacted]` and is **not chained**
    (`cause` would smuggle the unscrubbed original into any logger that serializes chains —
    the S17 rule). The adapter itself never logs.
- `TOKENS.SecretVault` bound via the selector factory in **both** persistence wirings
  (`persistence.module.ts` + `prisma/prisma-persistence.module.ts`), replacing the direct
  `new StubSecretVault()` bindings.
- `VAULT_MODE=offline` pins in all five harness/config locations (§0).
- Dependencies: `@azure/keyvault-secrets` + `@azure/identity` in `apps/api` only.

### Out of scope
- Any `SecretVault` port change — the frozen `put`/`get` signatures are untouched; consumers
  (`ConnectIntegration`, `DisconnectIntegration`, `SelectingBrain` BYOK resolution) are untouched.
- Secret deletion/purge on disconnect (`DisconnectIntegration` clears the row's `secretRef`
  today and never calls the vault; vault-side lifecycle/rotation is a follow-up).
- Other vault backends (AWS KMS/Secrets Manager, HashiCorp Vault) — they drop in behind the
  same port + selector.
- Key Vault soft-delete/purge-protection provisioning (infra/bicep concern, not app code).
- Caching of `get` results (the BYOK caller already caches per `orgId+secretRef`).

---

## 2. The `secretRef` + secret-name contract

**The ref format is UNCHANGED:** `put(scope, secret)` returns `vault://<scope>` — byte-identical
to the stub's contract — where `scope` = `<orgId>/<integration key>` (built by
`ConnectIntegration`). This is load-bearing: `Integration.secretRef` rows persist that string,
and `SelectingBrain.resolveOrgBrain` parses the `vault://` prefix back off and calls
`get(<scope>)`. Stub-written rows therefore resolve against the real vault and vice versa —
only the storage backend differs.

**Key Vault secret names** only allow `[0-9a-zA-Z-]` (1–127 chars) **and the namespace is
case-INSENSITIVE** (Microsoft docs), but scopes contain `/` (always) and `_` (`ado_repos`).
`encodeVaultSecretName` maps a scope **deterministically and injectively — in KV's
case-insensitive namespace** (two distinct scopes can NEVER collide into one secret name — a
collision would cross-write tenants' secrets):

- strictly lowercase `0-9 a-z` pass through verbatim;
- **every other character** — including `-`, `/` and UPPERCASE letters — is escaped as `-hh`
  per UTF-8 byte (two lowercase hex digits): `-` → `-2d`, `/` → `-2f`, `_` → `-5f`, `A` → `-41`.
  Uppercase is escaped, NOT case-folded: folding `A`→`a` would collide with a literal `a` at
  the string level, and passing `A-Z` through would collide inside KV's case-insensitive
  namespace (e.g. scopes `a-2D` and `a-2d` would both land on the KV secret `a-2d2d`).

Injectivity: escapes are the ONLY source of `-` in the output, every escape is exactly `-hh`,
and the output alphabet is strictly `[0-9a-z-]` — so KV's case-insensitive equality collapses
to string equality and the encoding is prefix-free and reversible. Example:

```
scope  f81d4fae-7dec-11d0-a765-00a0c91e6bf6/anthropic
name   f81d4fae-2d7dec-2d11d0-2da765-2d00a0c91e6bf6-2fanthropic
```

A UUID orgId + the longest catalog key encodes to ~60 chars — comfortably inside 127. An empty
scope, or one encoding past 127 chars, throws a `KeyVaultError` naming the scope (scopes are
`orgId/key` — never secret material).

---

## 3. Acceptance criteria

- **AC-VAULT-01 (offline pin)** `vaultFromEnv()` returns the slice-6 `StubSecretVault` only
  under an EXPLICIT `VAULT_MODE=offline` (even when `AZURE_KEY_VAULT_URL` is also set); no
  client is ever constructed in that mode; every test harness pins `VAULT_MODE=offline`; the
  existing slice-6/9 integration+BYOK BDD keeps passing unchanged through the factory-bound
  token (incl. key rotation by re-connect — the executable regression scenario).
- **AC-VAULT-02 (real selection)** With `AZURE_KEY_VAULT_URL` set and no offline pin,
  `vaultFromEnv()` returns `AzureKeyVaultSecretVault` and builds the client from the trimmed
  URL with `DefaultAzureCredential`.
- **AC-VAULT-03 (security inversion — boot refusal)** Without `AZURE_KEY_VAULT_URL` and
  without explicit `VAULT_MODE=offline`, `vaultFromEnv()` THROWS a clear error naming both
  variables — missing config never silently selects the stub. Belt-and-braces:
  `VAULT_MODE=offline` under `NODE_ENV=production` also throws (the stub refuses production).
- **AC-VAULT-04 (ref contract + name mapping)** `put(scope, secret)` stores the secret under
  `encodeVaultSecretName(scope)` and returns `vault://<scope>` (the stub's exact contract);
  `get(scope)` reads through the same encoding and returns the value; a missing secret
  (HTTP 404 / `SecretNotFound`) returns `null`, never throws. The mapping is deterministic,
  injective **against KV's case-insensitive namespace**, and emits only strictly lowercase
  `[0-9a-z-]` (§2); invalid results (empty / >127) throw without any secret in the message.
- **AC-VAULT-05 (no secret leak)** Any client failure surfaces as a rejected promise carrying
  a fresh `KeyVaultError` whose message NEVER contains the secret value (asserted against a
  client error that echoes it back), never chains the original via `cause`, and keeps the
  non-secret diagnostic (operation + encoded name + scrubbed provider message). The secret
  value appears in no log, DB row, or View (the slice-6 S6-B guarantee, now backend-real).

---

## 4. BDD — what is (and isn't) in the `.feature`

`secret-vault.feature`:

- **Executable in the default sweep** (offline stub via the harness pin, existing steps only):
  the `@AC-VAULT-01` rotation regression — connect `anthropic` with one key, re-connect with a
  new key, assert the row is connected with a `secretRef` and NEITHER raw key appears anywhere
  in the database or audit trail. This pins the factory rebinding + the ref contract end-to-end.
- **`@wip`** (`@AC-VAULT-02/03`): boot-time selector behavior (refusal, real-adapter selection)
  is not HTTP-observable inside the sweep — the BDD app is pinned `VAULT_MODE=offline` and a
  boot refusal would take the whole harness down, not answer a request. Proven by the
  Docker-free unit tests (the S15 AC-SSO-07 precedent).
- **`@manual`** (`@AC-VAULT-04/05`): the live round-trip against a REAL Azure Key Vault needs
  credentials + network — excluded from every automated sweep by tag, kept as the documented
  manual smoke.

---

## 5. Traceability

| AC | Proof |
|----|-------|
| AC-VAULT-01 | `azure-key-vault.test.ts` (mode resolution + stub selection + no-client assert) · harness pins · `secret-vault.feature` `@AC-VAULT-01` (+ the whole existing 06/09 BDD staying green) |
| AC-VAULT-02 | `azure-key-vault.test.ts` (selection + trimmed-URL client factory, via the injected seam) |
| AC-VAULT-03 | `azure-key-vault.test.ts` (unconfigured throw naming both vars; production refusal of the stub) |
| AC-VAULT-04 | `azure-key-vault.test.ts` (encode mapping incl. injectivity + limits; put/get round-trip; 404/`SecretNotFound` → null) · `@manual` live smoke |
| AC-VAULT-05 | `azure-key-vault.test.ts` (scrubbed `KeyVaultError`, no `cause`, non-Error throw, get-path failure) |

---

## 6. Security notes

- The secret VALUE exists only in the request argument and inside Azure — never in a return
  value other than `get`'s, never in an error (`[redacted]`), never chained via `cause`, never
  logged, never in a DB row (only `vault://<scope>` refs persist — the frozen §2 rule).
- Scopes and encoded secret names are NOT secret (`<orgId>/<key>`) and may appear in error
  messages — that keeps boot/ops diagnostics useful without risk.
- `DefaultAzureCredential` means no vault credential lives in app env at all in production
  (managed identity); locally it falls back to `az login` / env service-principal vars, which
  this adapter never reads or logs itself.
- The security inversion (§0) is the load-bearing decision: a secret vault that silently
  downgrades to an in-memory map is a data-loss AND disclosure hazard, so absence of config is
  a boot failure, and the stub self-refuses production. Mirrors S15; stricter (throw, not
  degrade) because there is no graceful "vault unavailable" product state.
