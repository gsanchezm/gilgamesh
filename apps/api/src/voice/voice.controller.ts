import { type AudioOutput, SynthesizeChatSpeech, TranscribeChatAudio } from '@gilgamesh/application';
import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SpeakDto, TranscribeDto } from './dto';

/**
 * Voice in chat (slice 42): STT dictate + TTS read-back behind the {@link VoicePort}. A dedicated
 * controller — the chat SSE `ChatController` is untouched (AC-VOICE-03). Same `SessionAuthGuard`,
 * CSRF and project-scope as the other chat mutations; both routes are throttled by the global
 * `RateLimitGuard` (added to its `LIMITED_PATHS`, `bucket:'suffix'`), inheriting the `/messages`
 * per-IP brain-cost limit. Non-member → NOT_FOUND (404) inside the use cases (AC-VOICE-04).
 */
@Controller('chat')
@UseGuards(SessionAuthGuard)
export class VoiceController {
  constructor(
    private readonly transcribeChatAudio: TranscribeChatAudio,
    private readonly synthesizeChatSpeech: SynthesizeChatSpeech,
  ) {}

  /** Audio → text; the transcript is dropped into the composer client-side (batch, no auto-send). */
  @Post(':sessionId/transcribe')
  @HttpCode(200)
  transcribe(
    @CurrentUser() userId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: TranscribeDto,
  ): Promise<{ text: string }> {
    return this.transcribeChatAudio.execute({
      userId,
      sessionId,
      audio: { data: dto.audio.data, mimeType: dto.audio.mimeType },
      language: dto.language,
    });
  }

  /** Text → audio; the client plays the returned clip (read aloud). */
  @Post(':sessionId/speak')
  @HttpCode(200)
  speak(
    @CurrentUser() userId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: SpeakDto,
  ): Promise<{ audio: AudioOutput }> {
    return this.synthesizeChatSpeech.execute({ userId, sessionId, text: dto.text, voice: dto.voice });
  }
}
