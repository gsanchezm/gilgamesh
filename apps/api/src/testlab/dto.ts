import type { ProjectFormat, TestCasePriority } from '@gilgamesh/application';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const PRIORITIES: TestCasePriority[] = ['HIGH', 'MEDIUM', 'LOW'];
const FORMATS: ProjectFormat[] = ['BDD', 'TRADITIONAL'];

export class CreateSliceDto {
  @IsString() @IsNotEmpty() @MaxLength(64) key!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
}

export class UpdateSliceDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @IsOptional() @IsInt() order?: number;
}

export class CreateFeatureDto {
  @IsString() @IsNotEmpty() @MaxLength(256) path!: string;
  @IsString() @MaxLength(262144) content!: string;
  @IsOptional() @IsString() sliceId?: string;
}

export class UpdateFeatureDto {
  @IsOptional() @IsString() @MaxLength(262144) content?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(256) path?: string;
  @IsOptional() @IsString() sliceId?: string;
}

export class CreateTestCaseDto {
  @IsString() @IsNotEmpty() @MaxLength(256) title!: string;
  @IsOptional() @IsString() @MaxLength(20000) steps?: string;
  @IsOptional() @IsString() @MaxLength(20000) data?: string;
  @IsOptional() @IsString() @MaxLength(20000) expected?: string;
  @IsIn(PRIORITIES) priority!: TestCasePriority;
  @IsOptional() @IsString() sliceId?: string;
  @IsOptional() @IsString() assignedAgentId?: string;
}

export class UpdateTestCaseDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(256) title?: string;
  @IsOptional() @IsString() @MaxLength(20000) steps?: string;
  @IsOptional() @IsString() @MaxLength(20000) data?: string;
  @IsOptional() @IsString() @MaxLength(20000) expected?: string;
  @IsOptional() @IsIn(PRIORITIES) priority?: TestCasePriority;
  @IsOptional() @IsString() sliceId?: string;
  @IsOptional() @IsString() assignedAgentId?: string;
}

export class GenerateDto {
  @IsString() @IsNotEmpty() @MaxLength(2000) prompt!: string;
  @IsOptional() @IsIn(FORMATS) format?: ProjectFormat;
  @IsOptional() @IsInt() @Min(1) @Max(10) count?: number;
}
