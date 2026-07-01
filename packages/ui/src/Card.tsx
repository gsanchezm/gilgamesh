import type { ElementType, ReactNode } from 'react';

export interface CardProps {
  children: ReactNode;
  className?: string;
  as?: ElementType;
}

/** Base surface (var(--card), 1px border, card radius). The building block for KPIs, panels, cards. */
export function Card({ children, className, as: Tag = 'div' }: CardProps) {
  return <Tag className={`gx-card${className ? ` ${className}` : ''}`}>{children}</Tag>;
}
