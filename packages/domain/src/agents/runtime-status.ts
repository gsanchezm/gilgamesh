export type AgentRuntimeStatus = 'ACTIVE' | 'BUSY' | 'IDLE';

/**
 * Operational status is derived, never stored (keystone §1):
 * IDLE when the agent is not awake; BUSY when awake and a RunNode is running;
 * otherwise ACTIVE.
 */
export function deriveAgentRuntimeStatus(input: {
  enabled: boolean;
  hasRunningNode: boolean;
}): AgentRuntimeStatus {
  if (!input.enabled) return 'IDLE';
  return input.hasRunningNode ? 'BUSY' : 'ACTIVE';
}
