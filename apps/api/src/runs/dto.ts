import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const TARGET_KINDS = ['FEATURE', 'TESTCASE'] as const;

export class TriggerRunDto {
  @IsIn(TARGET_KINDS)
  targetKind!: 'FEATURE' | 'TESTCASE';

  @IsString()
  targetId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  runLabel?: string;
}
