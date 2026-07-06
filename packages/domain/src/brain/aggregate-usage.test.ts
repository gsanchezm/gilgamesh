import { describe, expect, it } from 'vitest';
import { aggregateBrainUsage } from './aggregate-usage';

const row = (tier: string, surface: string, inputTokens: number, outputTokens: number) => ({
  tier: tier as 'HAIKU' | 'SONNET' | 'OPUS',
  surface: surface as 'CHAT' | 'ROUTER' | 'GENERATE' | 'EMBED',
  inputTokens,
  outputTokens,
  cacheReadTokens: 0,
  cacheCreateTokens: 0,
});

describe('aggregateBrainUsage (pure fold — AC-METER-03)', () => {
  it('returns zeros for no usage', () => {
    const agg = aggregateBrainUsage([]);
    expect(agg.totals).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 });
    expect(agg.byTier).toEqual([]);
    expect(agg.bySurface).toEqual([]);
  });

  it('folds totals and groups by tier and surface in canonical order', () => {
    const agg = aggregateBrainUsage([
      row('SONNET', 'CHAT', 100, 50),
      row('HAIKU', 'ROUTER', 10, 5),
      row('SONNET', 'CHAT', 200, 100),
      row('SONNET', 'GENERATE', 300, 150),
    ]);
    expect(agg.totals).toMatchObject({ calls: 4, inputTokens: 610, outputTokens: 305 });
    // Canonical enum order, present-only: HAIKU before SONNET; CHAT, ROUTER, GENERATE.
    expect(agg.byTier.map((t) => t.tier)).toEqual(['HAIKU', 'SONNET']);
    expect(agg.byTier[1]).toMatchObject({ calls: 3, inputTokens: 600, outputTokens: 300 });
    expect(agg.bySurface.map((s) => s.surface)).toEqual(['CHAT', 'ROUTER', 'GENERATE']);
    expect(agg.bySurface[0]).toMatchObject({ calls: 2, inputTokens: 300, outputTokens: 150 });
  });

  it('carries cache token totals', () => {
    const agg = aggregateBrainUsage([
      { ...row('HAIKU', 'ROUTER', 1, 1), cacheReadTokens: 7, cacheCreateTokens: 3 },
    ]);
    expect(agg.totals.cacheReadTokens).toBe(7);
    expect(agg.totals.cacheCreateTokens).toBe(3);
  });
});
