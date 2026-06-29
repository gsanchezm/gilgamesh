import { DomainError } from '../errors';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A URL-safe identifier derived from, or validated against, a display name. */
export class Slug {
  private constructor(public readonly value: string) {}

  static fromName(name: string): Slug {
    const value = name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '') // strip diacritics
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64)
      .replace(/-+$/g, '');
    if (!value) throw new DomainError(`Cannot derive a slug from "${name}"`);
    return new Slug(value);
  }

  static create(raw: string): Slug {
    if (!SLUG_RE.test(raw)) throw new DomainError(`Invalid slug: "${raw}"`);
    return new Slug(raw);
  }

  toString(): string {
    return this.value;
  }
}
