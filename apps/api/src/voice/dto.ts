import { Type } from 'class-transformer';
import { IsObject, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { INPUT_LIMITS } from '../common/input-limits';

/** The recorded clip carried by a transcribe request — base64 bytes + MIME type. */
export class AudioInputDto {
  @IsString()
  @MinLength(1)
  @MaxLength(INPUT_LIMITS.voiceAudioMax)
  data!: string;

  @IsString()
  @MaxLength(128)
  mimeType!: string;
}

/** `POST /chat/:sessionId/transcribe` — audio → text. */
export class TranscribeDto {
  @IsObject()
  @ValidateNested()
  @Type(() => AudioInputDto)
  audio!: AudioInputDto;

  /** Optional BCP-47 language hint (e.g. `en-US`). */
  @IsOptional()
  @IsString()
  @MaxLength(35)
  language?: string;
}

/** `POST /chat/:sessionId/speak` — text → audio. */
export class SpeakDto {
  @IsString()
  @MaxLength(INPUT_LIMITS.chatMessageMax)
  text!: string;

  /** Optional provider voice name (e.g. `en-US-JennyNeural`). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  voice?: string;
}
