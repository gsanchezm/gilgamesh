import type { Response } from 'supertest';

/** Extract the session + csrf cookies and the csrf token from a register/login response. */
export function authOf(res: Response): { cookie: string; csrf: string } {
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  const pairs: string[] = [];
  let csrf = '';
  for (const c of cookies) {
    const pair = String(c).split(';')[0];
    if (pair.startsWith('__Host-gg_session=')) pairs.push(pair);
    if (pair.startsWith('csrf=')) {
      pairs.push(pair);
      csrf = pair.slice('csrf='.length);
    }
  }
  return { cookie: pairs.join('; '), csrf };
}
