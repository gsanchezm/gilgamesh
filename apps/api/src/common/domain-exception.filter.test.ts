import { ApplicationError } from '@gilgamesh/application';
import { NotFoundException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { DomainExceptionFilter } from './domain-exception.filter';

function capture() {
  const res = {
    status: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  return { res, host };
}

describe('DomainExceptionFilter (catch-all -> problem+json)', () => {
  it('maps an ApplicationError to its code + status', () => {
    const { res, host } = capture();
    new DomainExceptionFilter().catch(new ApplicationError('RATE_LIMITED', 'too many'), host);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.type).toHaveBeenCalledWith('application/problem+json');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'RATE_LIMITED', status: 429 }));
  });

  it('preserves the status of a Nest HttpException', () => {
    const { res, host } = capture();
    new DomainExceptionFilter().catch(new NotFoundException(), host);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.type).toHaveBeenCalledWith('application/problem+json');
  });

  it('maps a Prisma unique-violation (P2002) to 409 CONFLICT', () => {
    const { res, host } = capture();
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '6.x',
    });
    new DomainExceptionFilter().catch(err, host);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'CONFLICT' }));
  });

  it('maps a Prisma record-not-found (P2025) to 404 NOT_FOUND', () => {
    const { res, host } = capture();
    const err = new Prisma.PrismaClientKnownRequestError('Record to update not found', {
      code: 'P2025',
      clientVersion: '6.x',
    });
    new DomainExceptionFilter().catch(err, host);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('maps an unmapped/infra error to a generic 500 without leaking internals', () => {
    const { res, host } = capture();
    new DomainExceptionFilter().catch(new Error('ECONNREFUSED 6379 redis'), host);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'INTERNAL', detail: 'An unexpected error occurred.' }),
    );
  });
});
