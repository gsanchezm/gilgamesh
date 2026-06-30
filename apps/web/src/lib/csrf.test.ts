import { afterEach, describe, expect, it } from 'vitest';
import { readCsrfToken } from './csrf';

function clearCookies() {
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }
}

describe('readCsrfToken', () => {
  afterEach(clearCookies);

  it('returns an empty string when no csrf cookie is present', () => {
    expect(readCsrfToken()).toBe('');
  });

  it('reads the csrf cookie value', () => {
    document.cookie = 'csrf=tok-abc';
    expect(readCsrfToken()).toBe('tok-abc');
  });

  it('picks the csrf cookie out of several cookies', () => {
    document.cookie = 'theme=dark';
    document.cookie = 'csrf=tok-xyz';
    expect(readCsrfToken()).toBe('tok-xyz');
  });
});
