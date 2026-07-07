/** Preset ring diameters (px). Use a number for anything bespoke. */
export type SpinnerSize = 'sm' | 'md' | 'lg' | number;

const PRESET_PX: Record<'sm' | 'md' | 'lg', number> = { sm: 16, md: 22, lg: 34 };

export interface SpinnerProps {
  /** Announced to assistive tech and used as the spinner's accessible name. */
  label?: string;
  size?: SpinnerSize;
  className?: string;
}

/**
 * Accessible busy indicator: a rotating gold-topped ring (reuses the `gxspin` keyframe) plus a
 * visually-hidden label so `role="status"` resolves an accessible name. Theme-independent (tokens
 * only); the ring animation eases off under `prefers-reduced-motion` (handled in styles.css).
 */
export function Spinner({ label = 'Loading…', size = 'md', className }: SpinnerProps) {
  const px = typeof size === 'number' ? size : PRESET_PX[size];
  return (
    // `aria-label` names the region (the `status` role does not take its name from content); the
    // visually-hidden text gives the live region something to announce when the spinner appears.
    <span role="status" aria-label={label} className={`gx-spinner${className ? ` ${className}` : ''}`}>
      <span className="gx-spinner__ring" style={{ width: px, height: px }} aria-hidden="true" />
      <span className="gx-vh">{label}</span>
    </span>
  );
}
