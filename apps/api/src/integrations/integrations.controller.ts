import {
  ConnectIntegration,
  DisconnectIntegration,
  ImportRepoFeatures,
  type IntegrationView,
  ListIntegrations,
} from '@gilgamesh/application';
import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ImportRepoDto, PatchIntegrationDto } from './dto';

@Controller('orgs/:orgId/integrations')
@UseGuards(SessionAuthGuard)
export class OrgIntegrationsController {
  constructor(
    private readonly list: ListIntegrations,
    private readonly connect: ConnectIntegration,
    private readonly disconnect: DisconnectIntegration,
  ) {}

  @Get()
  listIntegrations(@CurrentUser() userId: string, @Param('orgId') orgId: string): Promise<IntegrationView[]> {
    return this.list.execute({ userId, orgId });
  }

  // Single keystone mutator: connect/disconnect routed by the body's `action` (PATCH /…/{key}).
  @Patch(':key')
  patch(
    @CurrentUser() userId: string,
    @Param('orgId') orgId: string,
    @Param('key') key: string,
    @Body() dto: PatchIntegrationDto,
  ): Promise<IntegrationView> {
    if (dto.action === 'disconnect') return this.disconnect.execute({ userId, orgId, key });
    return this.connect.execute({ userId, orgId, key, token: dto.token ?? '' });
  }
}

@Controller('projects/:projectId/repo')
@UseGuards(SessionAuthGuard)
export class ProjectRepoController {
  constructor(private readonly importRepo: ImportRepoFeatures) {}

  // [S6-NEW] import .feature files from the org's connected source repo into the Test Lab.
  @Post('import')
  @HttpCode(200)
  import(
    @CurrentUser() userId: string,
    @Param('projectId') projectId: string,
    @Body() dto: ImportRepoDto,
  ): Promise<{ imported: number }> {
    return this.importRepo.execute({ userId, projectId, fullName: dto.fullName, branch: dto.branch ?? 'main' });
  }
}
