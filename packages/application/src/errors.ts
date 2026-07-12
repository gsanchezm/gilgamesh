export type AppErrorCode =
  | 'EMAIL_IN_USE'
  | 'WEAK_PASSWORD'
  | 'INVALID_CREDENTIALS'
  | 'USER_DISABLED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'INVALID_TOOL'
  | 'VALIDATION'
  // A well-formed but invalid/expired/consumed password-reset token. Distinct from VALIDATION so the
  // per-IP lockout (slice 39) can count a real bad-token attempt WITHOUT counting a legit user's
  // weak-new-password DTO rejection (which stays VALIDATION). Maps to 422, same as VALIDATION.
  | 'RESET_TOKEN_INVALID'
  | 'CSRF_FAILED'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'QUOTA_EXCEEDED';

/** A use-case-level failure with a stable code that adapters map to a transport status. */
export class ApplicationError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}
