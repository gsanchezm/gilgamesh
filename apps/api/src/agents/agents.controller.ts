import {
  type AgentRoomAgentView,
  type AgentRoomView,
  GetAgentRoom,
  SetAgentToolBinding,
  WakeAllAgents,
} from '@gilgamesh/application';
import type { AgentSlot } from '@gilgamesh/domain';
import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SetAgentToolDto } from './dto/set-agent-tool.dto';

@Controller('projects/:id/agents')
@UseGuards(SessionAuthGuard)
export class AgentsController {
  constructor(
    private readonly getAgentRoom: GetAgentRoom,
    private readonly setAgentTool: SetAgentToolBinding,
    private readonly wakeAllAgents: WakeAllAgents,
  ) {}

  @Get()
  async list(
    @CurrentUser() userId: string,
    @Param('id') projectId: string,
  ): Promise<AgentRoomView> {
    return this.getAgentRoom.execute({ userId, projectId });
  }

  @Patch(':slot')
  async patch(
    @CurrentUser() userId: string,
    @Param('id') projectId: string,
    @Param('slot') slot: string,
    @Body() dto: SetAgentToolDto,
  ): Promise<AgentRoomAgentView> {
    return this.setAgentTool.execute({
      userId,
      projectId,
      slot: slot as AgentSlot,
      tool: dto.tool,
      enabled: dto.enabled,
    });
  }

  @Post('wake-all')
  @HttpCode(200)
  async wakeAll(
    @CurrentUser() userId: string,
    @Param('id') projectId: string,
  ): Promise<{ awake: number; total: number }> {
    return this.wakeAllAgents.execute({ userId, projectId });
  }
}
