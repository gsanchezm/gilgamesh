import {
  type ChatSessionRepository,
  type MembershipRepository,
  type ProjectRepository,
  SynthesizeChatSpeech,
  TranscribeChatAudio,
  type VoicePort,
} from '@gilgamesh/application';
import { Module } from '@nestjs/common';
import { TOKENS as T } from '../persistence/tokens';
import { VoiceController } from './voice.controller';

/**
 * Wires the two voice use cases (slice 42) to the bound ports — the session-repo/project-repo/
 * membership-repo trio (the same authz gate as GetChatEvents) + the {@link VoicePort} (the
 * deterministic stub offline, the Azure adapter when configured; selected by `voiceFromEnv` in
 * the persistence wirings).
 */
@Module({
  controllers: [VoiceController],
  providers: [
    {
      provide: TranscribeChatAudio,
      useFactory: (
        chatSessions: ChatSessionRepository,
        projects: ProjectRepository,
        memberships: MembershipRepository,
        voice: VoicePort,
      ) => new TranscribeChatAudio({ chatSessions, projects, memberships, voice }),
      inject: [T.ChatSessions, T.Projects, T.Memberships, T.Voice],
    },
    {
      provide: SynthesizeChatSpeech,
      useFactory: (
        chatSessions: ChatSessionRepository,
        projects: ProjectRepository,
        memberships: MembershipRepository,
        voice: VoicePort,
      ) => new SynthesizeChatSpeech({ chatSessions, projects, memberships, voice }),
      inject: [T.ChatSessions, T.Projects, T.Memberships, T.Voice],
    },
  ],
})
export class VoiceModule {}
