import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id';
import type { PasswordHasher, TokenGenerator } from '../ports/security';

export class FakeClock implements Clock {
  constructor(private current: Date = new Date('2026-06-29T12:00:00.000Z')) {}
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
  set(date: Date): void {
    this.current = new Date(date);
  }
}

export class SeqIdGenerator implements IdGenerator {
  private n = 0;
  constructor(private readonly prefix = 'id') {}
  next(): string {
    this.n += 1;
    return `${this.prefix}-${this.n}`;
  }
}

/** Deterministic and reversible — for tests only, never wired into infra. */
export class FakePasswordHasher implements PasswordHasher {
  async hash(plain: string): Promise<string> {
    return `hashed:${plain}`;
  }
  async verify(plain: string, hash: string): Promise<boolean> {
    return hash === `hashed:${plain}`;
  }
}

export class FakeTokenGenerator implements TokenGenerator {
  private n = 0;
  generate(): { token: string; tokenHash: string } {
    this.n += 1;
    const token = `tok-${this.n}`;
    return { token, tokenHash: `th:${token}` };
  }
}
