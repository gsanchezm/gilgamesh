import { describe, expect, it } from 'vitest';
import { Slug } from './slug';
import { DomainError } from '../errors';

describe('Slug', () => {
  it('derives a slug from a display name', () => {
    expect(Slug.fromName('OmniPizza').value).toBe('omnipizza');
  });

  it('strips accents and collapses separators', () => {
    expect(Slug.fromName('  Café  del  Río!! ').value).toBe('cafe-del-rio');
  });

  it('rejects names with no slug-able characters', () => {
    expect(() => Slug.fromName('!!!')).toThrow(DomainError);
  });

  it('validates an explicit slug and rejects malformed ones', () => {
    expect(Slug.create('omni-pizza').value).toBe('omni-pizza');
    expect(() => Slug.create('Omni Pizza')).toThrow(DomainError);
  });
});
