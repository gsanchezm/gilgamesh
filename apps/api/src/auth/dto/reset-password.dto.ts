import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { INPUT_LIMITS } from '../../common/input-limits';

/** ResetPasswordRequest (slice-1 §13 named request schema). */
export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(INPUT_LIMITS.resetTokenMax)
  token!: string;

  @IsString()
  @MinLength(INPUT_LIMITS.passwordMin)
  @MaxLength(INPUT_LIMITS.passwordMax)
  newPassword!: string;
}
