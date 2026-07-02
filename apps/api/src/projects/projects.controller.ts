import { CompleteOnboarding } from '@gilgamesh/application';
import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { CreateProjectDto } from './dto/create-project.dto';

@Controller('projects')
@UseGuards(SessionAuthGuard)
export class ProjectsController {
  constructor(private readonly onboarding: CompleteOnboarding) {}

  @Post()
  @HttpCode(201)
  async create(
    @CurrentUser() userId: string,
    @Body() dto: CreateProjectDto,
  ): Promise<{ orgId: string; projectId: string; slug: string }> {
    return this.onboarding.execute({
      userId,
      orgName: dto.orgName,
      projectName: dto.projectName,
      format: dto.format,
      repoProvider: dto.repoProvider,
      repoFullName: dto.repoFullName,
      repoBranch: dto.repoBranch,
    });
  }
}
