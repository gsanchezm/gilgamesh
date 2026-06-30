import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { INPUT_LIMITS } from '../../common/input-limits';

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(INPUT_LIMITS.nameMax)
  firstName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(INPUT_LIMITS.nameMax)
  middleName?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(INPUT_LIMITS.nameMax)
  lastName!: string;

  @IsEmail()
  @MaxLength(INPUT_LIMITS.emailMax)
  email!: string;

  @IsString()
  @MinLength(INPUT_LIMITS.passwordMin)
  @MaxLength(INPUT_LIMITS.passwordMax)
  password!: string;
}
