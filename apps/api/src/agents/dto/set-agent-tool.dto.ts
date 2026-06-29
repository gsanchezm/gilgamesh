import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class SetAgentToolDto {
  @IsOptional()
  @IsString()
  tool?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
