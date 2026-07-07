import { ApplicationError } from '@gilgamesh/application';
import { NotFoundException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { DomainExceptionFilter } from './domain-exception.filter';

function capture(headers: Record<string, unknown> = {}) {
  const res = {
    status: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
  };
  const req = { headers };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;
  return { res, req, host };
}

/** The RFC9457 body emitted to `res.json` for the (single) call under test. */
function body(res: { json: ReturnType<typeof vi.fn> }): Record<string, unknown> {
  return (res.json.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
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

  it('maps a Prisma malformed-id (P2023) to 404 NOT_FOUND', () => {
    const { res, host } = capture();
    const err = new Prisma.PrismaClientKnownRequestError('Inconsistent column data: Error creating UUID', {
      code: 'P2023',
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

  it('adds an additive requestId that equals the X-Request-Id response header (slice 24)', () => {
    // No middleware ran (empty headers) → the filter generates a fresh id and echoes it on the header.
    const { res, host } = capture();
    new DomainExceptionFilter().catch(new ApplicationError('NOT_FOUND', 'nope'), host);
    const b = body(res);
    // The five existing members are unchanged (additive extension, not a shape change).
    expect(b).toMatchObject({ type: 'about:blank', status: 404, code: 'NOT_FOUND', detail: 'nope' });
    expect(b.title).toBe('NOT_FOUND');
    // The additive member is present, non-empty, and equals the echoed response header (stable).
    expect(typeof b.requestId).toBe('string');
    expect(b.requestId).not.toBe('');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', b.requestId);
  });

  it('echoes a sane request-scoped X-Request-Id into the error body (slice 24)', () => {
    // Mirrors the state after the middleware runs: the normalized id sits on the request header.
    const { res, host } = capture({ 'x-request-id': 'trace-abc_123.9' });
    new DomainExceptionFilter().catch(new ApplicationError('RATE_LIMITED', 'slow down'), host);
    expect(body(res).requestId).toBe('trace-abc_123.9');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'trace-abc_123.9');
  });
});
