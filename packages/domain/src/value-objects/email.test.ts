import { describe, expect, it } from 'vitest';
import { Email } from './email';
import { DomainError } from '../errors';

describe('Email', () => {
  it('normalizes to lowercase and trims surrounding whitespace', () => {
    expect(Email.create('  Gilberto@Example.COM ').value).toBe('gilberto@example.com');
  });

  it('treats case-different addresses as equal', () => {
    expect(Email.create('a@b.com').equals(Email.create('A@B.com'))).toBe(true);
  });

  it.each(['', 'no-at', 'a@b', 'a b@c.com', 'a@b .com'])('rejects "%s"', (bad) => {
    expect(() => Email.create(bad)).toThrow(DomainError);
  });
});
