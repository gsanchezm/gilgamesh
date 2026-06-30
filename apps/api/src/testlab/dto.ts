import type { ProjectFormat, TestCasePriority } from '@gilgamesh/application';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { INPUT_LIMITS as L } from '../common/input-limits';

const PRIORITIES: TestCasePriority[] = ['HIGH', 'MEDIUM', 'LOW'];
const FORMATS: ProjectFormat[] = ['BDD', 'TRADITIONAL'];

export class CreateSliceDto {
  @IsString() @IsNotEmpty() @MaxLength(L.sliceKeyMax) key!: string;
  @IsString() @IsNotEmpty() @MaxLength(L.sliceNameMax) name!: string;
}

export class UpdateSliceDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(L.sliceNameMax) name?: string;
  @IsOptional() @IsInt() order?: number;
}

export class CreateFeatureDto {
  @IsString() @IsNotEmpty() @MaxLength(L.featurePathMax) path!: string;
  @IsString() @MaxLength(L.featureContentMax) content!: string;
  @IsOptional() @IsString() sliceId?: string;
}

export class UpdateFeatureDto {
  @IsOptional() @IsString() @MaxLength(L.featureContentMax) content?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(L.featurePathMax) path?: string;
  @IsOptional() @IsString() sliceId?: string;
}

export class CreateTestCaseDto {
  @IsString() @IsNotEmpty() @MaxLength(L.testCaseTitleMax) title!: string;
  @IsOptional() @IsString() @MaxLength(L.testCaseTextMax) steps?: string;
  @IsOptional() @IsString() @MaxLength(L.testCaseTextMax) data?: string;
  @IsOptional() @IsString() @MaxLength(L.testCaseTextMax) expected?: string;
  @IsIn(PRIORITIES) priority!: TestCasePriority;
  @IsOptional() @IsString() sliceId?: string;
  @IsOptional() @IsString() assignedAgentId?: string;
}

export class UpdateTestCaseDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(L.testCaseTitleMax) title?: string;
  @IsOptional() @IsString() @MaxLength(L.testCaseTextMax) steps?: string;
  @IsOptional() @IsString() @MaxLength(L.testCaseTextMax) data?: string;
  @IsOptional() @IsString() @MaxLength(L.testCaseTextMax) expected?: string;
  @IsOptional() @IsIn(PRIORITIES) priority?: TestCasePriority;
  @IsOptional() @IsString() sliceId?: string;
  @IsOptional() @IsString() assignedAgentId?: string;
}

export class GenerateDto {
  @IsString() @IsNotEmpty() @MaxLength(L.generatePromptMax) prompt!: string;
  @IsOptional() @IsIn(FORMATS) format?: ProjectFormat;
  @IsOptional() @IsInt() @Min(L.generateCountMin) @Max(L.generateCountMax) count?: number;
}
