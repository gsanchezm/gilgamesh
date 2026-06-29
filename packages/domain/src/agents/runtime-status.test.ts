import { describe, expect, it } from 'vitest';
import { deriveAgentRuntimeStatus } from './runtime-status';

describe('deriveAgentRuntimeStatus', () => {
  it('is IDLE when not enabled, regardless of running nodes', () => {
    expect(deriveAgentRuntimeStatus({ enabled: false, hasRunningNode: true })).toBe('IDLE');
  });

  it('is BUSY when enabled and a node is running', () => {
    expect(deriveAgentRuntimeStatus({ enabled: true, hasRunningNode: true })).toBe('BUSY');
  });

  it('is ACTIVE when enabled and idle', () => {
    expect(deriveAgentRuntimeStatus({ enabled: true, hasRunningNode: false })).toBe('ACTIVE');
  });
});
