export type AppErrorCode =
  | 'EMAIL_IN_USE'
  | 'WEAK_PASSWORD'
  | 'INVALID_CREDENTIALS'
  | 'USER_DISABLED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'INVALID_TOOL'
  | 'VALIDATION'
  | 'CSRF_FAILED';

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
