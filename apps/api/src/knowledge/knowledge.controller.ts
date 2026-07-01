import {
  type KnowledgeDocumentView,
  ListKnowledgeDocuments,
  SearchKnowledge,
  type SearchResultView,
  UploadKnowledgeDocument,
} from '@gilgamesh/application';
import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { UploadKnowledgeDocumentDto } from './dto';

/**
 * The shared knowledge base is GLOBAL (no orgId, owner decision S5-A), so this endpoint is org-agnostic —
 * any authenticated user searches the same collection. Authentication is still required.
 */
@Controller('knowledge')
@UseGuards(SessionAuthGuard)
export class KnowledgeController {
  constructor(private readonly searchKnowledge: SearchKnowledge) {}

  @Get('search')
  search(@Query('q') q?: string, @Query('k') k?: string): Promise<SearchResultView> {
    const parsedK = k !== undefined && k !== '' ? Number(k) : undefined;
    return this.searchKnowledge.execute({ query: q ?? '', k: Number.isFinite(parsedK) ? parsedK : undefined });
  }
}

/**
 * Per-org uploaded documents (slice 7). Tenant-scoped: a non-member gets NOT_FOUND in the use case.
 * These chunks are stored with `orgId` and excluded from the global search above (no cross-org leak).
 */
@Controller('orgs/:orgId/knowledge')
@UseGuards(SessionAuthGuard)
export class OrgKnowledgeController {
  constructor(
    private readonly uploadDocument: UploadKnowledgeDocument,
    private readonly listDocuments: ListKnowledgeDocuments,
  ) {}

  @Get('documents')
  documents(
    @CurrentUser() userId: string,
    @Param('orgId') orgId: string,
  ): Promise<KnowledgeDocumentView[]> {
    return this.listDocuments.execute({ orgId, userId });
  }

  @Post('documents')
  @HttpCode(201)
  upload(
    @CurrentUser() userId: string,
    @Param('orgId') orgId: string,
    @Body() dto: UploadKnowledgeDocumentDto,
  ): Promise<KnowledgeDocumentView> {
    return this.uploadDocument.execute({
      orgId,
      userId,
      name: dto.name,
      type: dto.type,
      content: dto.content,
    });
  }
}
