import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsOptional()
  @IsString()
  middleName?: string;

  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
  password!: string;
}
