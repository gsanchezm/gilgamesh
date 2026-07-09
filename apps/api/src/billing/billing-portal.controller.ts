import { StartBillingPortal } from '@gilgamesh/application';
import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';

/**
 * Slice 34 (portal-only): `POST /orgs/{orgId}/billing/portal` mints a Stripe hosted billing-portal
 * link for an OWNER/ADMIN. Mounted at `orgs/:orgId/billing` (alongside `billing/webhooks/:provider`)
 * so the subscription controller stays untouched. OWNER/ADMIN only; a non-member gets 404; an org
 * with no billing account gets 422. Same session guard + global CSRF as the other billing mutations.
 */
@Controller('orgs/:orgId/billing')
@UseGuards(SessionAuthGuard)
export class BillingPortalController {
  constructor(private readonly startBillingPortal: StartBillingPortal) {}

  @Post('portal')
  @HttpCode(200)
  portal(@CurrentUser() userId: string, @Param('orgId') orgId: string): Promise<{ portalUrl: string }> {
    return this.startBillingPortal.execute({ userId, orgId });
  }
}
