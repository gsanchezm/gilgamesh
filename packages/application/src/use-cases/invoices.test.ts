import { describe, expect, it } from 'vitest';
import { ApplicationError } from '../errors';
import type { InvoiceRecord } from '../ports/records';
import { createInMemoryContext } from '../testing/in-memory';
import { ListInvoices } from './invoices';

function invoice(overrides: Partial<InvoiceRecord>): InvoiceRecord {
  return {
    id: 'inv-1',
    orgId: 'org-1',
    providerInvoiceId: 'in_1',
    status: 'OPEN',
    amountCents: 2900,
    currency: 'usd',
    periodStart: null,
    periodEnd: null,
    hostedInvoiceUrl: null,
    pdfUrl: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

function setup() {
  const ctx = createInMemoryContext();
  const useCase = new ListInvoices({ invoices: ctx.invoices, memberships: ctx.memberships });
  return { ctx, useCase };
}

async function member(ctx: ReturnType<typeof createInMemoryContext>, userId: string, orgId: string) {
  await ctx.memberships.create({ id: `m-${userId}`, orgId, userId, role: 'MEMBER', createdAt: new Date() });
}

describe('ListInvoices', () => {
  it('returns the org invoices newest-first to a member (AC-PAY-01)', async () => {
    const { ctx, useCase } = setup();
    await member(ctx, 'u1', 'org-1');
    await ctx.invoices.upsertByProviderInvoiceId(
      invoice({ id: 'inv-old', providerInvoiceId: 'in_old', createdAt: new Date('2026-07-01T00:00:00Z') }),
    );
    await ctx.invoices.upsertByProviderInvoiceId(
      invoice({ id: 'inv-new', providerInvoiceId: 'in_new', status: 'PAID', createdAt: new Date('2026-07-02T00:00:00Z') }),
    );

    const views = await useCase.execute({ userId: 'u1', orgId: 'org-1' });
    expect(views.map((v) => v.id)).toEqual(['inv-new', 'inv-old']);
    expect(views[0]).toMatchObject({ status: 'PAID', amountCents: 2900, currency: 'usd', providerInvoiceId: 'in_new' });
  });

  it("never returns another org's invoices (tenant isolation)", async () => {
    const { ctx, useCase } = setup();
    await member(ctx, 'u1', 'org-1');
    await ctx.invoices.upsertByProviderInvoiceId(invoice({ id: 'inv-other', orgId: 'org-2', providerInvoiceId: 'in_o' }));

    expect(await useCase.execute({ userId: 'u1', orgId: 'org-1' })).toEqual([]);
  });

  it('a non-member gets NOT_FOUND, never FORBIDDEN (AC-PAY-06)', async () => {
    const { useCase } = setup();
    await expect(useCase.execute({ userId: 'intruder', orgId: 'org-1' })).rejects.toMatchObject(
      new ApplicationError('NOT_FOUND', 'Organization not found.'),
    );
  });
});
