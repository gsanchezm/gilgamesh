import {
  CreateFeature,
  DeleteFeature,
  type FeatureSummaryView,
  type FeatureView,
  GetFeature,
  ListFeatures,
  UpdateFeature,
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
import { CreateFeatureDto, UpdateFeatureDto } from './dto';

@Controller('projects/:projectId/features')
@UseGuards(SessionAuthGuard)
export class ProjectFeaturesController {
  constructor(
    private readonly createFeature: CreateFeature,
    private readonly listFeatures: ListFeatures,
  ) {}

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() userId: string,
    @Param('projectId') projectId: string,
    @Body() dto: CreateFeatureDto,
  ): Promise<FeatureView> {
    return this.createFeature.execute({
      userId,
      projectId,
      path: dto.path,
      content: dto.content,
      sliceId: dto.sliceId,
    });
  }

  @Get()
  list(
    @CurrentUser() userId: string,
    @Param('projectId') projectId: string,
    @Query('sliceId') sliceId?: string,
  ): Promise<FeatureSummaryView[]> {
    return this.listFeatures.execute({ userId, projectId, sliceId });
  }
}

@Controller('features')
@UseGuards(SessionAuthGuard)
export class FeatureController {
  constructor(
    private readonly getFeature: GetFeature,
    private readonly updateFeature: UpdateFeature,
    private readonly deleteFeature: DeleteFeature,
  ) {}

  @Get(':id')
  get(@CurrentUser() userId: string, @Param('id') featureId: string): Promise<FeatureView> {
    return this.getFeature.execute({ userId, featureId });
  }

  @Patch(':id')
  update(
    @CurrentUser() userId: string,
    @Param('id') featureId: string,
    @Body() dto: UpdateFeatureDto,
  ): Promise<FeatureView> {
    return this.updateFeature.execute({
      userId,
      featureId,
      content: dto.content,
      path: dto.path,
      sliceId: dto.sliceId,
    });
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() userId: string, @Param('id') featureId: string): Promise<void> {
    await this.deleteFeature.execute({ userId, featureId });
  }
}
