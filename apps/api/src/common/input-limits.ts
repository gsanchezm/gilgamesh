/**
 * Single source of truth for request-input size bounds. DTO `@MaxLength`/`@Min`/`@Max`
 * decorators and the HTTP body-parser limit are both driven from here so they can never drift
 * apart (audit #1/#2): every bound a client can hit is declared once, and {@link JSON_BODY_LIMIT}
 * is provably larger than the biggest single field a valid request can carry.
 *
 * Bounds are deliberate, not arbitrary — they cap CPU/memory abuse (e.g. argon2 hashing a
 * megabyte password) before validation runs, and keep the body limit deterministic.
 */
export const INPUT_LIMITS = {
  /** RFC 5321 caps a full email address at 254 octets. */
  emailMax: 254,
  /** First / middle / last name. */
  nameMax: 120,
  /** Password: keystone minimum; max caps hashing cost (argon2id has no native input ceiling). */
  passwordMin: 12,
  passwordMax: 200,
  /** Reset token: base64url of 32 CSPRNG bytes is 43 chars; 256 leaves headroom without inviting abuse. */
  resetTokenMax: 256,

  /** Test Lab — slice. */
  sliceKeyMax: 64,
  sliceNameMax: 120,

  /** Test Lab — feature. `contentMax` is the largest single field any request carries. */
  featurePathMax: 256,
  featureContentMax: 262_144,

  /** Test Lab — test case. */
  testCaseTitleMax: 256,
  testCaseTextMax: 20_000,

  /** AI generate prompt. */
  generatePromptMax: 2_000,
  generateCountMin: 1,
  generateCountMax: 10,

  /** Agent Chat (slice 8) — must match the application layer's MAX_MESSAGE_CHARS. */
  chatMessageMax: 4_000,
} as const;

/**
 * Express JSON / urlencoded body limit. Must exceed the largest single field
 * ({@link INPUT_LIMITS.featureContentMax} = 256 KiB) plus JSON envelope + string escaping, or the
 * biggest *valid* feature would be rejected with 413 by the body parser before DTO validation ever
 * runs. 512 KiB leaves ~2× headroom over the 256 KiB content field. Keep this strictly greater than
 * `featureContentMax`; the body-limit e2e test asserts both the accept and the 413 boundary.
 */
export const JSON_BODY_LIMIT = '512kb';
