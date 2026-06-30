import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { INPUT_LIMITS } from '../../common/input-limits';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(INPUT_LIMITS.emailMax)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(INPUT_LIMITS.passwordMax)
  password!: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
