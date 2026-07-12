import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';
import { DeterministicVoice } from '../voice/deterministic-voice';
import type { AudioInput, VoicePort } from '../ports/voice';
import { CreateChatSession } from './chat';
import { CompleteOnboarding } from './complete-onboarding';
import { RegisterUser } from './register-user';
import { SynthesizeChatSpeech, TranscribeChatAudio } from './voice';

/**
 * Slice 42 — the two session-scoped voice use cases. Authz mirrors GetChatEvents exactly (findById →
 * NOT_FOUND, then requireProjectAccess): a non-member gets NOT_FOUND (never 403), so tenant existence
 * is not leaked (AC-VOICE-04). Delegation to the bound VoicePort is verified with the deterministic stub.
 */
describe('Voice use cases (TranscribeChatAudio / SynthesizeChatSpeech)', () => {
  let ctx: InMemoryContext;
  let userId: string;
  let orgId: string;
  let projectId: string;
  let sessionId: string;
  const voice: VoicePort = new DeterministicVoice();
  const audio: AudioInput = { data: 'aGVsbG8=', mimeType: 'audio/webm' };
  const deps = () => ({ chatSessions: ctx.chatSessions, projects: ctx.projects, memberships: ctx.memberships, voice });

  beforeEach(async () => {
    ctx = createInMemoryContext();
    userId = (
      await new RegisterUser(ctx).execute({ firstName: 'I', lastName: 'U', email: 'owner@uruk.io', password: 'C0rrect-Horse!' })
    ).userId;
    const o = await new CompleteOnboarding(ctx).execute({ userId, projectName: 'OmniPizza', format: 'BDD' });
    orgId = o.orgId;
    projectId = o.projectId;
    sessionId = (await new CreateChatSession(ctx).execute({ userId, projectId })).id;
  });

  it('transcribes for a member and returns the stub transcript (AC-VOICE-01/02)', async () => {
    const { text } = await new TranscribeChatAudio(deps()).execute({ userId, sessionId, audio });
    expect(text).toBe((await voice.transcribe(audio)).text);
    expect(text.length).toBeGreaterThan(0);
  });

  it('synthesizes speech for a member (read aloud)', async () => {
    const { audio: out } = await new SynthesizeChatSpeech(deps()).execute({ userId, sessionId, text: 'Zeus here.' });
    expect(out.mimeType).toMatch(/^audio\//);
    expect(out.data.length).toBeGreaterThan(0);
  });

  it('delegates language/voice opts to the port', async () => {
    const spy: VoicePort = {
      transcribe: vi.fn(async () => ({ text: 'ok' })),
      synthesize: vi.fn(async () => ({ audio: { data: 'x', mimeType: 'audio/mpeg' } })),
    };
    const d = { chatSessions: ctx.chatSessions, projects: ctx.projects, memberships: ctx.memberships, voice: spy };
    await new TranscribeChatAudio(d).execute({ userId, sessionId, audio, language: 'en-US' });
    expect(spy.transcribe).toHaveBeenCalledWith(audio, { language: 'en-US' });
    await new SynthesizeChatSpeech(d).execute({ userId, sessionId, text: 'hi', voice: 'en-US-JennyNeural' });
    expect(spy.synthesize).toHaveBeenCalledWith('hi', { voice: 'en-US-JennyNeural' });
  });

  it('404s a missing session on both routes', async () => {
    await expect(
      new TranscribeChatAudio(deps()).execute({ userId, sessionId: 'nope', audio }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      new SynthesizeChatSpeech(deps()).execute({ userId, sessionId: 'nope', text: 'hi' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('404s a non-member — session existence is not leaked (AC-VOICE-04)', async () => {
    const outsider = (
      await new RegisterUser(ctx).execute({ firstName: 'E', lastName: 'X', email: 'eve@nippur.io', password: 'C0rrect-Horse!' })
    ).userId;
    await expect(
      new TranscribeChatAudio(deps()).execute({ userId: outsider, sessionId, audio }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      new SynthesizeChatSpeech(deps()).execute({ userId: outsider, sessionId, text: 'hi' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('validates: empty audio / empty text → VALIDATION', async () => {
    await expect(
      new TranscribeChatAudio(deps()).execute({ userId, sessionId, audio: { data: '', mimeType: 'audio/webm' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      new SynthesizeChatSpeech(deps()).execute({ userId, sessionId, text: '   ' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    void orgId;
  });
});
