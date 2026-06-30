/**
 * Reads the non-httpOnly `csrf` cookie that the API issues alongside the session cookie. The
 * value is echoed back as the `X-CSRF-Token` header on unsafe requests (double-submit), which the
 * server's CsrfGuard requires for every authenticated mutation.
 */
export function readCsrfToken(): string {
  const match = /(?:^|;\s*)csrf=([^;]*)/.exec(document.cookie);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}
