import { describe, expect, it } from 'vitest';
import { REQUEST_ID_MAX_LENGTH, normalizeRequestId } from './request-id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('normalizeRequestId', () => {
  it('trusts a sane, bounded, opaque token verbatim', () => {
    expect(normalizeRequestId('req-01H.abc_DEF-9')).toBe('req-01H.abc_DEF-9');
    expect(normalizeRequestId('018f4a2b-1234-4abc-8def-000000000001')).toBe(
      '018f4a2b-1234-4abc-8def-000000000001',
    );
  });

  // The security crux: a value carrying CR/LF must NEVER be trusted (header/log injection). JS `$`
  // without the `m` flag is \z-semantics, so "abc\n" is REJECTED (it does not match before a final
  // newline) — this pins that defense directly, since the wire/e2e can't transmit a raw CRLF.
  it.each(['abc\n', 'abc\r', 'abc\r\n', '\nabc', 'evil\r\nX-Injected: 1'])(
    'regenerates a fresh UUID for a value containing CR/LF (%j)',
    (evil) => {
      const id = normalizeRequestId(evil);
      expect(id).toMatch(UUID);
      expect(id).not.toContain('\n');
      expect(id).not.toContain('\r');
    },
  );

  it.each(['a b', 'a:b', 'a;b', 'a,b', 'a<b>', 'a"b', 'a/b'])(
    'regenerates for other unsafe characters (%j)',
    (bad) => {
      expect(normalizeRequestId(bad)).toMatch(UUID);
    },
  );

  it('regenerates for empty, over-length, or non-string input', () => {
    expect(normalizeRequestId('')).toMatch(UUID);
    expect(normalizeRequestId('a'.repeat(REQUEST_ID_MAX_LENGTH + 1))).toMatch(UUID);
    expect(normalizeRequestId(undefined)).toMatch(UUID);
    expect(normalizeRequestId(12345)).toMatch(UUID);
    expect(normalizeRequestId(['a, b'])).toMatch(UUID); // Express-joined duplicate headers
  });

  it('accepts a value exactly at the length cap', () => {
    const maxToken = 'a'.repeat(REQUEST_ID_MAX_LENGTH);
    expect(normalizeRequestId(maxToken)).toBe(maxToken);
  });
});
