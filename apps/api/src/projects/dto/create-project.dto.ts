import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateProjectDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  orgName?: string;

  @IsString()
  @IsNotEmpty()
  projectName!: string;

  @IsIn(['BDD', 'TRADITIONAL'])
  format!: 'BDD' | 'TRADITIONAL';

  @IsOptional()
  @IsIn(['github', 'gitlab', 'bitbucket', 'ado'])
  repoProvider?: 'github' | 'gitlab' | 'bitbucket' | 'ado';

  @IsOptional()
  @IsString()
  repoFullName?: string;

  @IsOptional()
  @IsString()
  repoBranch?: string;
}
