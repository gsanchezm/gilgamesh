import {
  CreateTestCase,
  DeleteTestCase,
  GenerateDrafts,
  type GeneratedDraftsView,
  GetTestCase,
  ListTestCases,
  type TestCaseView,
  UpdateTestCase,
} from '@gilgamesh/application';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { CreateTestCaseDto, GenerateDto, UpdateTestCaseDto } from './dto';

@Controller('projects/:projectId/test-cases')
@UseGuards(SessionAuthGuard)
export class ProjectTestCasesController {
  constructor(
    private readonly createTestCase: CreateTestCase,
    private readonly listTestCases: ListTestCases,
    private readonly generateDrafts: GenerateDrafts,
  ) {}

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() userId: string,
    @Param('projectId') projectId: string,
    @Body() dto: CreateTestCaseDto,
  ): Promise<TestCaseView> {
    return this.createTestCase.execute({
      userId,
      projectId,
      title: dto.title,
      steps: dto.steps,
      data: dto.data,
      expected: dto.expected,
      priority: dto.priority,
      sliceId: dto.sliceId,
      assignedAgentId: dto.assignedAgentId,
    });
  }

  @Get()
  list(
    @CurrentUser() userId: string,
    @Param('projectId') projectId: string,
    @Query('sliceId') sliceId?: string,
  ): Promise<TestCaseView[]> {
    return this.listTestCases.execute({ userId, projectId, sliceId });
  }

  @Post('generate')
  @HttpCode(200)
  generate(
    @CurrentUser() userId: string,
    @Param('projectId') projectId: string,
    @Body() dto: GenerateDto,
  ): Promise<GeneratedDraftsView> {
    return this.generateDrafts.execute({
      userId,
      projectId,
      prompt: dto.prompt,
      format: dto.format,
      count: dto.count,
    });
  }
}

@Controller('test-cases')
@UseGuards(SessionAuthGuard)
export class TestCaseController {
  constructor(
    private readonly getTestCase: GetTestCase,
    private readonly updateTestCase: UpdateTestCase,
    private readonly deleteTestCase: DeleteTestCase,
  ) {}

  @Get(':id')
  get(@CurrentUser() userId: string, @Param('id') testCaseId: string): Promise<TestCaseView> {
    return this.getTestCase.execute({ userId, testCaseId });
  }

  @Patch(':id')
  update(
    @CurrentUser() userId: string,
    @Param('id') testCaseId: string,
    @Body() dto: UpdateTestCaseDto,
  ): Promise<TestCaseView> {
    return this.updateTestCase.execute({ userId, testCaseId, ...dto });
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() userId: string, @Param('id') testCaseId: string): Promise<void> {
    await this.deleteTestCase.execute({ userId, testCaseId });
  }
}
