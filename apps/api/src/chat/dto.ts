import { IsOptional, IsString, MaxLength } from 'class-validator';
import { INPUT_LIMITS } from '../common/input-limits';

export class CreateChatSessionDto {
  /** Pin the session to one agent (opened from an agent tile); omitted = routed per message. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  agentId?: string;
}

export class SendChatMessageDto {
  @IsString()
  @MaxLength(INPUT_LIMITS.chatMessageMax)
  content!: string;
}
