import { type BrainUsageView, GetBrainUsage } from '@gilgamesh/application';
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';

/**
 * Keystone v0.3 B1 — `GET /orgs/{orgId}/brain/usage`: the org's aggregated per-tier/per-surface
 * token usage. Any member (incl. VIEWER) may read; a non-member gets 404 (no existence leak).
 */
@Controller('orgs/:orgId/brain')
@UseGuards(SessionAuthGuard)
export class BrainUsageController {
  constructor(private readonly getBrainUsage: GetBrainUsage) {}

  @Get('usage')
  usage(@CurrentUser() userId: string, @Param('orgId') orgId: string): Promise<BrainUsageView> {
    return this.getBrainUsage.execute({ userId, orgId });
  }
}
