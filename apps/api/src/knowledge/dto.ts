import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UploadKnowledgeDocumentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  // Supported file types: markdown, plain text, PDF, and Word documents.
  @IsIn(['md', 'txt', 'pdf', 'docx'])
  type!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200_000)
  content!: string;
}
