import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
