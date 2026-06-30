import { SearchKnowledge, type SearchResultView } from '@gilgamesh/application';
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session-auth.guard';

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
