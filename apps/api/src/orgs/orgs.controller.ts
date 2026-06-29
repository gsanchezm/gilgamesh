import {
  GetOrgSubscription,
  ListOrgAgents,
  type OrgAgentView,
  type SubscriptionView,
} from '@gilgamesh/application';
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';

@Controller('orgs/:orgId')
@UseGuards(SessionAuthGuard)
export class OrgsController {
  constructor(
    private readonly listOrgAgents: ListOrgAgents,
    private readonly getOrgSubscription: GetOrgSubscription,
  ) {}

  @Get('agents')
  async agents(
    @CurrentUser() userId: string,
    @Param('orgId') orgId: string,
  ): Promise<OrgAgentView[]> {
    return this.listOrgAgents.execute({ userId, orgId });
  }

  @Get('subscription')
  async subscription(
    @CurrentUser() userId: string,
    @Param('orgId') orgId: string,
  ): Promise<SubscriptionView> {
    return this.getOrgSubscription.execute({ userId, orgId });
  }
}
