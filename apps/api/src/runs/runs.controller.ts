import { GetRun, ListRuns, type RunSummaryView, type RunView, TriggerRun } from '@gilgamesh/application';
import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { TriggerRunDto } from './dto';

@Controller('projects/:projectId/runs')
@UseGuards(SessionAuthGuard)
export class ProjectRunsController {
  constructor(
    private readonly triggerRun: TriggerRun,
    private readonly listRuns: ListRuns,
  ) {}

  @Post()
  @HttpCode(201)
  trigger(
    @CurrentUser() userId: string,
    @Param('projectId') projectId: string,
    @Body() dto: TriggerRunDto,
  ): Promise<RunView> {
    return this.triggerRun.execute({
      userId,
      projectId,
      targetKind: dto.targetKind,
      targetId: dto.targetId,
      runLabel: dto.runLabel,
    });
  }

  @Get()
  list(@CurrentUser() userId: string, @Param('projectId') projectId: string): Promise<RunSummaryView[]> {
    return this.listRuns.execute({ userId, projectId });
  }
}

@Controller('runs')
@UseGuards(SessionAuthGuard)
export class RunController {
  constructor(private readonly getRun: GetRun) {}

  @Get(':id')
  get(@CurrentUser() userId: string, @Param('id') runId: string): Promise<RunView> {
    return this.getRun.execute({ userId, runId });
  }
}
