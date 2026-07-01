import type { ReactNode } from 'react';

export interface BadgeProps {
  children: ReactNode;
  /** Visual tone. `accent` = gold-on-soft, `muted` = subtle, `default` = bordered neutral. */
  tone?: 'default' | 'accent' | 'muted';
  className?: string;
}

/** Mono micro-label used for tool tags, counts and status pills (IBM Plex Mono, pill radius). */
export function Badge({ children, tone = 'default', className }: BadgeProps) {
  return <span className={`gx-badge gx-badge--${tone}${className ? ` ${className}` : ''}`}>{children}</span>;
}
