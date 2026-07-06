import { ApplicationError } from '../errors';

// Generous caps (our states are 43-char base64url; Google codes are well under 512) — a
// megabyte-sized query value must die here, not in a downstream hash or exchange call.
const MAX_STATE_LENGTH = 512;
const MAX_CODE_LENGTH = 2048;

/**
 * Narrows the frozen port's `completeLogin(input: unknown)` to the OAuth callback pair. Shared
 * by every OIDC provider (stub + Google) so the validation cannot drift between them.
 */
export function parseSsoCallbackInput(input: unknown): { code: string; state: string } {
  const o = (typeof input === 'object' && input !== null ? input : {}) as {
    code?: unknown;
    state?: unknown;
  };
  const code = typeof o.code === 'string' ? o.code : '';
  const state = typeof o.state === 'string' ? o.state : '';
  if (!code || !state || code.length > MAX_CODE_LENGTH || state.length > MAX_STATE_LENGTH) {
    throw new ApplicationError(
      'VALIDATION',
      'The sign-in callback is missing a valid code or state.',
    );
  }
  return { code, state };
}
