import {
  type ChatMessageView,
  type ChatSessionView,
  CreateChatSession,
  type EventBus,
  GetChatEvents,
  SendChatMessage,
} from '@gilgamesh/application';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { TOKENS } from '../persistence/tokens';
import { CreateChatSessionDto, SendChatMessageDto } from './dto';

/** Live-stream heartbeat cadence: an SSE comment line keeps proxies from idling the connection. */
const HEARTBEAT_MS = 15_000;

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
    @Inject(TOKENS.Events) private readonly bus: EventBus,
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
   * Keystone C3 — SSE, same pattern as `/runs/{id}/events`. Slice 9 (AC-SSE-01): replay the
   * session's persisted messages, then stay SUBSCRIBED to the `chat:{sessionId}` EventBus topic
   * and push live MESSAGE/DELTA/DONE events with a heartbeat; client disconnect unsubscribes.
   *
   * Harness compatibility: supertest/fetch-based clients buffer the body until the stream ENDS,
   * so a request whose `accept` does not include `text/event-stream` — or that sets `?replay=1` —
   * keeps the S8 semantics: replay + `DONE` + close. Only a real live client holds the connection.
   */
  @Get(':sessionId/events')
  async events(
    @CurrentUser() userId: string,
    @Param('sessionId') sessionId: string,
    @Query('replay') replay: string | undefined,
    @Req() req: Request,
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

    const wantsLive = (req.headers.accept ?? '').includes('text/event-stream') && replay !== '1';
    if (!wantsLive) {
      res.write('event: DONE\ndata: {}\n\n');
      res.end();
      return;
    }

    res.flushHeaders();
    const unsubscribe = this.bus.subscribe(`chat:${sessionId}`, (e) => {
      const type = typeof (e as { type?: unknown })?.type === 'string' ? (e as { type: string }).type : 'MESSAGE';
      res.write(`event: ${type}\ndata: ${JSON.stringify(e)}\n\n`);
    });
    const heartbeat = setInterval(() => {
      res.write(':hb\n\n'); // SSE comment line — ignored by EventSource, keeps the pipe warm
    }, HEARTBEAT_MS);
    heartbeat.unref?.();
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe(); // no leaked handler on the bus (AC-SSE-01)
    });
  }
}
