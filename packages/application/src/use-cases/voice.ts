import { ApplicationError } from '../errors';
import type { AudioInput, AudioOutput, VoicePort } from '../ports/voice';
import type { ChatSessionRepository, MembershipRepository, ProjectRepository } from '../ports/repositories';
import { requireProjectAccess } from './authz';

/** Voice is MEMBER+ end to end, like chat (spec 08 §10.2): a VIEWER may not dictate or read aloud. */
const AUTHORS = ['OWNER', 'ADMIN', 'MEMBER'] as const;
/** The largest text the read-aloud path will synthesize — mirrors the chat message cap (DTO-enforced too). */
const MAX_SPEAK_CHARS = 4000;

interface VoiceDeps {
  chatSessions: ChatSessionRepository;
  projects: ProjectRepository;
  memberships: MembershipRepository;
  voice: VoicePort;
}

/**
 * STT for the chat composer (slice 42, AC-VOICE-02/04): resolve the session, enforce project access
 * (non-member → NOT_FOUND, exactly like {@link GetChatEvents} — tenant existence is never leaked),
 * then delegate to the bound {@link VoicePort}. Batch: the transcript is returned for the composer;
 * nothing is persisted here (the member still sends).
 */
export class TranscribeChatAudio {
  constructor(private readonly deps: VoiceDeps) {}

  async execute(input: {
    userId: string;
    sessionId: string;
    audio: AudioInput;
    language?: string;
  }): Promise<{ text: string }> {
    if (!input.audio || typeof input.audio.data !== 'string' || !input.audio.data) {
      throw new ApplicationError('VALIDATION', 'Audio is required.');
    }
    const session = await this.deps.chatSessions.findById(input.sessionId);
    if (!session) throw new ApplicationError('NOT_FOUND', 'Chat session not found.');
    await requireProjectAccess(this.deps, input.userId, session.projectId, [...AUTHORS]);
    return this.deps.voice.transcribe(input.audio, input.language ? { language: input.language } : undefined);
  }
}

/**
 * TTS for the read-aloud action (slice 42, AC-VOICE-04): same session-scoped access gate as
 * {@link TranscribeChatAudio}, then synthesize the given text (the agent message already shown to
 * the member). Nothing is persisted.
 */
export class SynthesizeChatSpeech {
  constructor(private readonly deps: VoiceDeps) {}

  async execute(input: {
    userId: string;
    sessionId: string;
    text: string;
    voice?: string;
  }): Promise<{ audio: AudioOutput }> {
    const text = (input.text ?? '').trim();
    if (!text) throw new ApplicationError('VALIDATION', 'Text is required.');
    if (text.length > MAX_SPEAK_CHARS) {
      throw new ApplicationError('VALIDATION', `Text may not exceed ${MAX_SPEAK_CHARS} characters.`);
    }
    const session = await this.deps.chatSessions.findById(input.sessionId);
    if (!session) throw new ApplicationError('NOT_FOUND', 'Chat session not found.');
    await requireProjectAccess(this.deps, input.userId, session.projectId, [...AUTHORS]);
    return this.deps.voice.synthesize(text, input.voice ? { voice: input.voice } : undefined);
  }
}
