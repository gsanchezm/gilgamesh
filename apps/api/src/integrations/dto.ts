import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class PatchIntegrationDto {
  @IsIn(['connect', 'disconnect'])
  action!: 'connect' | 'disconnect';

  // The token travels in the body (HTTPS) and is verified then discarded — only a vault ref is stored.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  token?: string;
}

export class ImportRepoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  branch?: string;
}
