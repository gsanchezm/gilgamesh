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
   * Live push is an EXPLICIT opt-in (`?live=1`) — deterministic and proxy-proof (review S9 dropped
   * the Accept-header sniffing). Without it the S8 semantics hold: replay + `DONE` + close, which
   * is what buffering clients (supertest/fetch/the web replay resync) rely on.
   *
   * Lifecycle (review S9): in live mode the subscription starts BEFORE the persisted read — events
   * published meanwhile are buffered and flushed after the replay, deduped by replayed message id —
   * every write is guarded against a closed socket, and a disconnect at ANY point (even during the
   * initial DB read) tears down the subscription + heartbeat.
   */
  @Get(':sessionId/events')
  async events(
    @CurrentUser() userId: string,
    @Param('sessionId') sessionId: string,
    @Query('live') live: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    let closed = false;
    let heartbeat: NodeJS.Timeout | null = null;
    let unsubscribe: (() => void) | null = null;
    const cleanup = () => {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      unsubscribe?.(); // no leaked handler on the bus (AC-SSE-01)
      unsubscribe = null;
    };
    // Registered before any awaited work so an early disconnect is never missed.
    req.on('close', cleanup);

    const write = (frame: string): void => {
      if (closed || res.writableEnded || res.destroyed) return;
      try {
        res.write(frame);
      } catch {
        cleanup();
      }
    };
    const frameOf = (e: unknown): string => {
      const type = typeof (e as { type?: unknown })?.type === 'string' ? (e as { type: string }).type : 'MESSAGE';
      return `event: ${type}\ndata: ${JSON.stringify(e)}\n\n`;
    };

    const wantsLive = live === '1';
    // Live mode subscribes BEFORE the persisted read: anything published during the read/replay is
    // buffered and flushed afterwards (deduped by message id), so no event falls into the gap.
    const buffered: unknown[] = [];
    let replaying = true;
    if (wantsLive) {
      unsubscribe = this.bus.subscribe(`chat:${sessionId}`, (e) => {
        if (replaying) buffered.push(e);
        else write(frameOf(e));
      });
    }

    // Authz/tenant checks run BEFORE any byte is written, so failures still map to Problem+json.
    let messages;
    try {
      messages = await this.getChatEvents.execute({ userId, sessionId });
    } catch (e) {
      cleanup();
      throw e;
    }
    if (closed) return;

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const replayed = new Set<string>();
    for (const m of messages) {
      replayed.add(m.id);
      const data = {
        id: m.id,
        sessionId: m.sessionId,
        role: m.role,
        agentId: m.agentId,
        content: m.content,
        runId: m.runId,
        at: m.createdAt.toISOString(),
      };
      write(`event: MESSAGE\ndata: ${JSON.stringify(data)}\n\n`);
    }

    if (!wantsLive) {
      write('event: DONE\ndata: {}\n\n');
      if (!res.writableEnded) res.end();
      return;
    }

    res.flushHeaders();
    replaying = false;
    for (const e of buffered) {
      const id = (e as { id?: unknown })?.id;
      if (typeof id === 'string' && replayed.has(id)) continue; // already replayed
      write(frameOf(e));
    }
    buffered.length = 0;
    heartbeat = setInterval(() => {
      write(':hb\n\n'); // SSE comment line — ignored by EventSource, keeps the pipe warm
    }, HEARTBEAT_MS);
    heartbeat.unref?.();
    if (closed) cleanup();
  }
}
