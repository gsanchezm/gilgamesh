import {
  type ChatMessageView,
  type ChatSessionView,
  CreateChatSession,
  GetChatEvents,
  SendChatMessage,
} from '@gilgamesh/application';
import { Body, Controller, Get, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { CreateChatSessionDto, SendChatMessageDto } from './dto';

@Controller('projects/:projectId/chat')
@UseGuards(SessionAuthGuard)
export class ProjectChatController {
  constructor(private readonly createChatSession: CreateChatSession) {}

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() userId: string,
    @Param('projectId') projectId: string,
    @Body() dto: CreateChatSessionDto,
  ): Promise<ChatSessionView> {
    return this.createChatSession.execute({ userId, projectId, agentId: dto.agentId ?? null });
  }
}

@Controller('chat')
@UseGuards(SessionAuthGuard)
export class ChatController {
  constructor(
    private readonly sendChatMessage: SendChatMessage,
    private readonly getChatEvents: GetChatEvents,
  ) {}

  @Post(':sessionId/messages')
  @HttpCode(201)
  async send(
    @CurrentUser() userId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: SendChatMessageDto,
  ): Promise<ChatMessageView> {
    // 201 returns the persisted USER message (keystone C2); the answer arrives on the events stream.
    return (await this.sendChatMessage.execute({ userId, sessionId, content: dto.content })).message;
  }

  /**
   * Keystone C3 — SSE, same pattern as `/runs/{id}/events`. With the synchronous stub núcleo the
   * stream REPLAYS the session's persisted messages as MESSAGE events and closes with DONE; live
   * token push lands with the real Brain/Orchestration delivery (spec §13).
   */
  @Get(':sessionId/events')
  async events(
    @CurrentUser() userId: string,
    @Param('sessionId') sessionId: string,
    @Res() res: Response,
  ): Promise<void> {
    // Authz/tenant checks run BEFORE any byte is written, so failures still map to Problem+json.
    const messages = await this.getChatEvents.execute({ userId, sessionId });
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    for (const m of messages) {
      const data = {
        id: m.id,
        sessionId: m.sessionId,
        role: m.role,
        agentId: m.agentId,
        content: m.content,
        runId: m.runId,
        at: m.createdAt.toISOString(),
      };
      res.write(`event: MESSAGE\ndata: ${JSON.stringify(data)}\n\n`);
    }
    res.write('event: DONE\ndata: {}\n\n');
    res.end();
  }
}
