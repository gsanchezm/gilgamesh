import type { AgentRuntimeStatus } from '@gilgamesh/domain';

const STATUS_COLOR: Record<AgentRuntimeStatus, string> = {
  ACTIVE: '#2F8F5B',
  BUSY: '#C08A2E',
  IDLE: '#9AA0AC',
};

const STATUS_LABEL: Record<AgentRuntimeStatus, string> = {
  ACTIVE: 'Active',
  BUSY: 'Busy',
  IDLE: 'Idle',
};

export interface StatusDotProps {
  status: AgentRuntimeStatus;
  size?: number;
}

export function StatusDot({ status, size = 11 }: StatusDotProps) {
  return (
    <span
      role="status"
      aria-label={STATUS_LABEL[status]}
      data-status={status}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: STATUS_COLOR[status],
        animation: status === 'ACTIVE' ? 'gxpulse 2.2s ease-in-out infinite' : undefined,
      }}
    />
  );
}
