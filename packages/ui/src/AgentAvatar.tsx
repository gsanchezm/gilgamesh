import type { AgentRuntimeStatus } from '@gilgamesh/domain';
import { StatusDot } from './StatusDot';

/** Preset avatar sizes from the handoff (§5): nav rail, dashboard card, anatomy reference. */
export type AvatarSize = 'nav' | 'card' | 'ref' | number;

interface Dims {
  w: number;
  h: number;
  glyph: number;
  dot: number;
}

const PRESETS: Record<'nav' | 'card' | 'ref', Dims> = {
  nav: { w: 26, h: 28, glyph: 10, dot: 7 },
  card: { w: 56, h: 64, glyph: 16, dot: 11 },
  ref: { w: 72, h: 80, glyph: 20, dot: 13 },
};

function dimsFor(size: AvatarSize): Dims {
  if (typeof size === 'number') {
    return { w: size, h: size, glyph: Math.round(size * 0.3), dot: Math.round(size * 0.18) };
  }
  return PRESETS[size];
}

export interface AgentAvatarProps {
  /** Initials shown when there is no portrait image. */
  glyph: string;
  /** Discipline-family frame color (e.g. FAMILY_COLORS[family]). */
  familyColor: string;
  status: AgentRuntimeStatus;
  /** Portrait URL (e.g. portraitFor(slot)); falls back to glyph-on-gradient when absent. */
  portraitSrc?: string;
  /** Used as the avatar's accessible label when present. */
  deityName?: string;
  size?: AvatarSize;
}

/**
 * The agent's identity mark (handoff §5 anatomy): a family-colored rounded-square frame, an inset
 * portrait (or glyph-on-gradient fallback), and a status dot ringed in the surface color. Purely
 * presentational — wrap it in a button/link for interactivity.
 */
export function AgentAvatar({
  glyph,
  familyColor,
  status,
  portraitSrc,
  deityName,
  size = 'card',
}: AgentAvatarProps) {
  const { w, h, glyph: glyphSize, dot } = dimsFor(size);
  return (
    <span
      className="gx-avatar"
      data-status={status}
      style={{ width: w, height: h, background: familyColor }}
      aria-label={deityName}
      role={deityName ? 'img' : undefined}
    >
      <span
        className="gx-avatar__portrait"
        style={portraitSrc ? { backgroundImage: `url(${portraitSrc})` } : undefined}
      >
        {!portraitSrc && (
          <span className="gx-avatar__glyph" style={{ fontSize: glyphSize }}>
            {glyph}
          </span>
        )}
      </span>
      <span className="gx-avatar__dot">
        <StatusDot status={status} size={dot} />
      </span>
    </span>
  );
}
