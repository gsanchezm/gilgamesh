import { describe, expect, it } from 'vitest';
import { CHAT_TOOLS, claudeToolDefinitions, validateToolArgs } from './chat-tools';

describe('ChatToolRegistry — the single source for tool vocabulary (AC-TOOL-03)', () => {
  it('registers exactly the whitelist of 3', () => {
    expect(CHAT_TOOLS.map((t) => t.name).sort()).toEqual(['create_test_case', 'enqueue_run', 'generate_feature']);
  });

  it('generates Claude API tool definitions from the registry', () => {
    const defs = claudeToolDefinitions();
    expect(defs).toHaveLength(3);
    for (const def of defs) {
      expect(typeof def.name).toBe('string');
      expect(typeof def.description).toBe('string');
      expect(def.input_schema).toMatchObject({ type: 'object' });
    }
    const run = defs.find((d) => d.name === 'enqueue_run')!;
    expect(run.input_schema.required).toContain('featureName');
  });

  it('validates args against the schema (AC-TOOL-02)', () => {
    expect(validateToolArgs('enqueue_run', { featureName: 'Checkout' })).toBeNull();
    expect(validateToolArgs('enqueue_run', {})).toMatch(/featureName/);
    expect(validateToolArgs('enqueue_run', { featureName: 42 })).toMatch(/featureName/);
    expect(validateToolArgs('create_test_case', { title: 'cash' })).toBeNull();
    expect(validateToolArgs('create_test_case', {})).toMatch(/title/);
    expect(validateToolArgs('generate_feature', { prompt: 'refunds' })).toBeNull();
    expect(validateToolArgs('generate_feature', { prompt: '' })).toMatch(/prompt/);
  });

  it('reports an unknown tool as unregistered (AC-TOOL-04)', () => {
    expect(validateToolArgs('drop_database', {})).toBe('UNREGISTERED');
  });
});
