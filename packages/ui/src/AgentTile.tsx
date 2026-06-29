import type { AgentRuntimeStatus } from '@gilgamesh/domain';
import { StatusDot } from './StatusDot';

export interface AgentTileProps {
  deityName: string;
  role: string;
  glyph: string;
  familyColor: string;
  tool: string;
  status: AgentRuntimeStatus;
  enabled: boolean;
  onToggle?: () => void;
  onOpen?: () => void;
}

/** The signature agent-room card: family-framed glyph avatar, name/role/tool, status, wake toggle. */
export function AgentTile({
  deityName,
  role,
  glyph,
  familyColor,
  tool,
  status,
  enabled,
  onToggle,
  onOpen,
}: AgentTileProps) {
  return (
    <div className="gx-agent-tile" data-enabled={enabled} style={{ opacity: enabled ? 1 : 0.6 }}>
      <button
        type="button"
        className="gx-agent-tile__avatar"
        style={{ background: familyColor }}
        aria-label={`Open ${deityName}`}
        onClick={onOpen}
      >
        <span className="gx-agent-tile__glyph">{glyph}</span>
        <span style={{ position: 'absolute', right: -2, bottom: -2 }}>
          <StatusDot status={status} />
        </span>
      </button>

      <button type="button" className="gx-agent-tile__body" onClick={onOpen}>
        <span className="gx-agent-tile__name">{deityName}</span>
        <span className="gx-agent-tile__tool">{tool}</span>
        <span className="gx-agent-tile__role">{role}</span>
      </button>

      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`Toggle ${deityName}`}
        className="gx-agent-tile__toggle"
        onClick={onToggle}
        style={{ background: enabled ? 'var(--green)' : 'var(--track)' }}
      />
    </div>
  );
}
