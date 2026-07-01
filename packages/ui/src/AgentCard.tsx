import type { AgentRuntimeStatus, AgentSlot } from '@gilgamesh/domain';
import { AgentAvatar } from './AgentAvatar';

export interface AgentCardProps {
  slot: AgentSlot;
  deityName: string;
  role: string;
  culture: string;
  glyph: string;
  familyColor: string;
  tool: string;
  status: AgentRuntimeStatus;
  enabled: boolean;
  portraitSrc?: string;
  onToggle?: (next: boolean) => void;
  onWake?: () => void;
  onOpen?: () => void;
  onChat?: () => void;
}

/** Two-letter tool tag, e.g. "Helix Core" → "HE", "Strategy" → "ST". */
function toolTag(tool: string): string {
  return tool.replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase();
}

/**
 * The signature dashboard agent card (handoff §6.5): tool pill + wake toggle on top, the framed
 * portrait with name / role / culture, and discipline-aware CTAs — "Awaken" when asleep, "Open" +
 * "Chat" when awake. Sleeping agents dim to .6. Presentational; the host wires the handlers.
 */
export function AgentCard({
  deityName,
  role,
  culture,
  glyph,
  familyColor,
  tool,
  status,
  enabled,
  portraitSrc,
  onToggle,
  onWake,
  onOpen,
  onChat,
}: AgentCardProps) {
  return (
    <article className="gx-agentcard" data-enabled={enabled}>
      <header className="gx-agentcard__top">
        <span className="gx-agentcard__tool">
          <span className="gx-agentcard__tooltag">{toolTag(tool)}</span>
          <span className="gx-agentcard__toolname">{tool}</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={`Toggle ${deityName}`}
          className="gx-toggle"
          data-on={enabled}
          onClick={() => onToggle?.(!enabled)}
        />
      </header>

      <div className="gx-agentcard__id">
        <AgentAvatar
          size="card"
          glyph={glyph}
          familyColor={familyColor}
          status={status}
          portraitSrc={portraitSrc}
          deityName={deityName}
        />
        <div className="gx-agentcard__meta">
          <span className="gx-agentcard__name">{deityName}</span>
          <span className="gx-agentcard__role">{role}</span>
          <span className="gx-agentcard__culture">{culture}</span>
        </div>
      </div>

      <footer className="gx-agentcard__cta">
        {enabled ? (
          <>
            <button type="button" className="gx-btn gx-btn--secondary" onClick={onOpen}>
              Open
            </button>
            <button type="button" className="gx-btn gx-btn--secondary" onClick={onChat}>
              Chat
            </button>
          </>
        ) : (
          <button type="button" className="gx-btn gx-btn--primary" onClick={onWake}>
            Awaken
          </button>
        )}
      </footer>
    </article>
  );
}
