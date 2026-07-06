import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { INPUT_LIMITS } from '../../common/input-limits';

// ForgotPasswordRequest (slice-1 §13 named request schema). Like LoginDto it deliberately uses
// IsString (not IsEmail): a malformed address still gets the same generic 202 downstream — the
// endpoint's response must never vary with the input's plausibility (no enumeration).
export class ForgotPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(INPUT_LIMITS.emailMax)
  email!: string;
}
