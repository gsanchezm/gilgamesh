import { type InvoiceView, ListInvoices } from '@gilgamesh/application';
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';

/** Keystone §6 v0.5: the org's billing history. MEMBER+ may view; a non-member gets 404. */
@Controller('orgs/:orgId/invoices')
@UseGuards(SessionAuthGuard)
export class InvoicesController {
  constructor(private readonly listInvoices: ListInvoices) {}

  @Get()
  list(@CurrentUser() userId: string, @Param('orgId') orgId: string): Promise<InvoiceView[]> {
    return this.listInvoices.execute({ userId, orgId });
  }
}
