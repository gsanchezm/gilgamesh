import { ApplicationError } from '../errors';
import type { InvoiceRecord, InvoiceStatus } from '../ports/records';
import type { InvoiceRepository, MembershipRepository } from '../ports/repositories';

export interface InvoiceView {
  id: string;
  providerInvoiceId: string | null;
  status: InvoiceStatus;
  amountCents: number;
  currency: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  hostedInvoiceUrl: string | null;
  pdfUrl: string | null;
  createdAt: Date;
}

export function invoiceView(rec: InvoiceRecord): InvoiceView {
  return {
    id: rec.id,
    providerInvoiceId: rec.providerInvoiceId,
    status: rec.status,
    amountCents: rec.amountCents,
    currency: rec.currency,
    periodStart: rec.periodStart,
    periodEnd: rec.periodEnd,
    hostedInvoiceUrl: rec.hostedInvoiceUrl,
    pdfUrl: rec.pdfUrl,
    createdAt: rec.createdAt,
  };
}

/**
 * The org's billing history (keystone §6 `GET /orgs/{orgId}/invoices`), newest-first. Any org
 * member may view; a non-member gets NOT_FOUND — org existence is never leaked across tenants
 * (the same gate shape as GetOrgSubscription / requireProjectAccess).
 */
export class ListInvoices {
  constructor(private readonly deps: { invoices: InvoiceRepository; memberships: MembershipRepository }) {}

  async execute(input: { userId: string; orgId: string }): Promise<InvoiceView[]> {
    const role = await this.deps.memberships.findRole(input.orgId, input.userId);
    if (!role) throw new ApplicationError('NOT_FOUND', 'Organization not found.');
    return (await this.deps.invoices.listForOrg(input.orgId)).map(invoiceView);
  }
}
