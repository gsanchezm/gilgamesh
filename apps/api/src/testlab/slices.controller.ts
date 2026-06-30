import {
  CreateSlice,
  DeleteSlice,
  ListSlices,
  type SliceView,
  UpdateSlice,
} from '@gilgamesh/application';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { CreateSliceDto, UpdateSliceDto } from './dto';

@Controller('projects/:projectId/slices')
@UseGuards(SessionAuthGuard)
export class ProjectSlicesController {
  constructor(
    private readonly createSlice: CreateSlice,
    private readonly listSlices: ListSlices,
  ) {}

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() userId: string,
    @Param('projectId') projectId: string,
    @Body() dto: CreateSliceDto,
  ): Promise<SliceView> {
    return this.createSlice.execute({ userId, projectId, key: dto.key, name: dto.name });
  }

  @Get()
  list(@CurrentUser() userId: string, @Param('projectId') projectId: string): Promise<SliceView[]> {
    return this.listSlices.execute({ userId, projectId });
  }
}

@Controller('slices')
@UseGuards(SessionAuthGuard)
export class SliceController {
  constructor(
    private readonly updateSlice: UpdateSlice,
    private readonly deleteSlice: DeleteSlice,
  ) {}

  @Patch(':id')
  update(
    @CurrentUser() userId: string,
    @Param('id') sliceId: string,
    @Body() dto: UpdateSliceDto,
  ): Promise<SliceView> {
    return this.updateSlice.execute({ userId, sliceId, name: dto.name, order: dto.order });
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() userId: string, @Param('id') sliceId: string): Promise<void> {
    await this.deleteSlice.execute({ userId, sliceId });
  }
}
