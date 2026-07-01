import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UploadKnowledgeDocumentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  // Real text ingest only for now; PDF/docx parsing (new deps) is a follow-up.
  @IsIn(['md', 'txt'])
  type!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200_000)
  content!: string;
}
