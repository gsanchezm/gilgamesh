# Slice 17 — Real SMTP email adapter behind the frozen `EmailPort` (SDD Spec)

> Spec-Driven-Design spec for slice 17 of Gilgamesh — a SMALL, infra-only adapter slice.
> Authority order: **Keystone** (`specs/_keystone/foundation-vocabulary.md`) — `EmailPort` §5 is
> **frozen verbatim** and does NOT change — → **Decisions log** → **Slice-12 spec**
> (`specs/slices/12-auth-recovery/spec.md`), whose §2 "Out of scope" deferral ("Real email delivery
> (SMTP/SES adapter) — adapter swap behind §5 `EmailPort`") this slice closes.
> v0.1 — 2026-07-06. Status: APPROVED FOR TDD. Branch `feat-email-adapter`.

---

## 0. Owner decision S17

**Real mail = a nodemailer SMTP adapter** (`SmtpEmail`) behind the frozen §5 `EmailPort` — SMTP is
the lowest common denominator (works against any provider, including the SES SMTP endpoint), so no
provider SDK is taken on. **Selection is env-driven, the slice-9 `brainFromEnv` pattern**
(`apps/api/src/infra/selecting-brain.ts`): `emailFromEnv()` —

- `EMAIL_MODE=offline` **OR** missing/blank `SMTP_URL` → the slice-12 `StubEmail` (records mail
  in-memory; the BDD/e2e recorded-mail seam keeps working untouched).
- Otherwise → `SmtpEmail` over `nodemailer.createTransport(SMTP_URL)`.

Config env vars:

| Var | Meaning | Default |
|-----|---------|---------|
| `SMTP_URL` | Standard `smtp(s)://user:pass@host:port` connection URL. **Contains a credential.** | unset → stub |
| `EMAIL_MODE` | `offline` forces the stub even when `SMTP_URL` is set (harness/CI pin). | auto by `SMTP_URL` |
| `EMAIL_FROM` | RFC 5322 `From` header for outbound mail. | `Gilgamesh <no-reply@gilgamesh.local>` |

**ALL suites/CI stay offline (stub):** `EMAIL_MODE=offline` is pinned in every harness the S9 way
(`apps/api/vitest.config.ts`, `vitest.int.config.ts`, `test/setup.ts`, `cucumber.cjs`,
`apps/web/playwright.config.ts`) — defense in depth against a dev machine exporting `SMTP_URL`.

---

## 1. Scope

### In scope
- `apps/api/src/infra/smtp-email.ts` — `SmtpEmail implements EmailPort` over an **injected transport
  seam** (`SmtpTransport.sendMail`; unit tests inject a fake, the real factory builds
  `nodemailer.createTransport(SMTP_URL)` lazily — no connection until the first send).
- `emailFromEnv()` selector + `resolveEmailMode()` (the `brainFromEnv`/`resolveBrainMode` idiom).
- **Credential scrubbing:** any transport failure propagates as a fresh `SmtpEmailError` whose
  message has the full `SMTP_URL`, and its password (raw **and** percent-decoded), replaced with
  `[redacted]`; the original error is **not chained** (`cause` would smuggle the unscrubbed text
  into logs). Nothing about the URL is ever logged by the adapter.
- `TOKENS.Email` bound via the selector factory in **both** persistence wirings
  (`persistence.module.ts` + `prisma/prisma-persistence.module.ts`).
- Dependency: `nodemailer` (+ `@types/nodemailer` dev) in `apps/api` only.

### Out of scope
- HTML mail, templates, attachments (the frozen port carries `{to, subject, text}` only).
- Provider SDKs (SES API, SendGrid API), DKIM/SPF setup, bounce/complaint webhooks.
- Retry/queueing of failed sends (the sole caller — forgot-password — already treats dispatch
  failure as a 5xx-free internal concern per slice 12; a mail queue is its own slice).
- Any `EmailPort`/use-case/UI change — this is precisely the "adapter swap, no use-case or UI
  change" promised by owner decision S12.

---

## 2. Acceptance criteria

- **AC-EML-01 (offline default)** `emailFromEnv()` returns the slice-12 `StubEmail` when
  `EMAIL_MODE=offline` (even with `SMTP_URL` set) or when `SMTP_URL` is missing/blank; no transport
  is ever constructed in that mode. Every test harness pins `EMAIL_MODE=offline`.
- **AC-EML-02 (real send mapping)** With `SMTP_URL` set (and no offline pin), `send({to, subject,
  text})` maps verbatim onto the nodemailer message `{from, to, subject, text}` where `from` =
  `EMAIL_FROM` (trimmed) or the default `Gilgamesh <no-reply@gilgamesh.local>`.
- **AC-EML-03 (no credential leak)** A transport failure surfaces as a rejected `send()` carrying a
  `SmtpEmailError` whose message never contains the `SMTP_URL` or its password (raw or
  percent-decoded) and never chains the original error; an unparseable `SMTP_URL` is scrubbed as a
  whole string.
- **AC-EML-04 (recovery regression, offline)** The slice-12 forgot/reset-password flow keeps
  working with the stub: the existing slice-12 BDD scenarios (AC-AUTH-10/11/12, AC-REC-01..04) and
  e2e pass unchanged with the new factory-bound `TOKENS.Email`.

---

## 3. BDD — why NO new `.feature` file

Deliberately none (per the anti-padding rule):

- The **offline/stub behavior** (mail recorded, token dispatched, no enumeration) is already
  asserted end-to-end by `specs/slices/12-auth-recovery/auth-recovery.feature` through the very
  `TOKENS.Email` seam this slice rebinds — a new scenario would re-assert the same observable
  behavior and be **redundant**. AC-EML-04 is exactly that existing suite staying green.
- The **real SMTP path** is not Gherkin-able inside the sweep's constraints: the sweep runs
  offline/deterministic (no network, no SMTP server), and standing up a mail sink is an
  integration-infrastructure concern out of proportion for an adapter this size. The adapter's
  behavior (selection, mapping, scrubbing) is fully covered by unit tests against the injected
  transport seam (`apps/api/test/smtp-email.test.ts`), the `claude-brain`/`selecting-brain`
  precedent.

---

## 4. Traceability

| AC | Proof |
|----|-------|
| AC-EML-01 | `smtp-email.test.ts` (mode resolution + stub selection + no-transport assert) · harness pins |
| AC-EML-02 | `smtp-email.test.ts` (field mapping, default + custom `EMAIL_FROM`, via injected fake transport) |
| AC-EML-03 | `smtp-email.test.ts` (scrubbed error message, decoded password, unparseable URL, no `cause`) |
| AC-EML-04 | existing slice-12 BDD + `auth-recovery.e2e.test.ts`, unchanged, green under the factory binding |

---

## 5. Security notes

- `SMTP_URL` is a secret-bearing config value (password in the URL userinfo). The adapter treats it
  accordingly: it exists only in env and inside the built transport; the scrub list derived from it
  (`smtpSecretsFrom`) is used to redact **every** outbound error message. The username is not
  scrubbed (commonly a non-secret account identifier, e.g. `apikey`); the password always is.
- `SmtpEmailError` is constructed WITHOUT `cause` so no unscrubbed original can reach a logger that
  serializes error chains.
- The stub keeps the slice-12 guarantee: nothing sensitive (token, link, address) is ever logged.
