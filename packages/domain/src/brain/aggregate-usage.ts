/**
 * Pure fold of BrainUsage rows into the per-org usage view (keystone v0.3): grand totals plus
 * per-tier and per-surface groupings in canonical enum order (present-only).
 */
export type BrainTierKey = 'HAIKU' | 'SONNET' | 'OPUS';
export type BrainSurfaceKey = 'CHAT' | 'ROUTER' | 'GENERATE' | 'EMBED';

export interface BrainUsageRow {
  tier: BrainTierKey;
  surface: BrainSurfaceKey;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
}

export interface BrainUsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
}

export interface BrainUsageAggregate {
  totals: BrainUsageTotals;
  byTier: ({ tier: BrainTierKey } & BrainUsageTotals)[];
  bySurface: ({ surface: BrainSurfaceKey } & BrainUsageTotals)[];
}

const TIER_ORDER: BrainTierKey[] = ['HAIKU', 'SONNET', 'OPUS'];
const SURFACE_ORDER: BrainSurfaceKey[] = ['CHAT', 'ROUTER', 'GENERATE', 'EMBED'];

function zero(): BrainUsageTotals {
  return { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 };
}

function add(acc: BrainUsageTotals, row: BrainUsageRow): void {
  acc.calls += 1;
  acc.inputTokens += row.inputTokens;
  acc.outputTokens += row.outputTokens;
  acc.cacheReadTokens += row.cacheReadTokens;
  acc.cacheCreateTokens += row.cacheCreateTokens;
}

export function aggregateBrainUsage(rows: BrainUsageRow[]): BrainUsageAggregate {
  const totals = zero();
  const byTier = new Map<BrainTierKey, BrainUsageTotals>();
  const bySurface = new Map<BrainSurfaceKey, BrainUsageTotals>();
  for (const row of rows) {
    add(totals, row);
    if (!byTier.has(row.tier)) byTier.set(row.tier, zero());
    add(byTier.get(row.tier)!, row);
    if (!bySurface.has(row.surface)) bySurface.set(row.surface, zero());
    add(bySurface.get(row.surface)!, row);
  }
  return {
    totals,
    byTier: TIER_ORDER.filter((t) => byTier.has(t)).map((tier) => ({ tier, ...byTier.get(tier)! })),
    bySurface: SURFACE_ORDER.filter((s) => bySurface.has(s)).map((surface) => ({ surface, ...bySurface.get(surface)! })),
  };
}
