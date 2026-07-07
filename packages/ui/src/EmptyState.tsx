import type { ReactNode } from 'react';
import { Button } from './Button';
import { IconInbox } from './icons';

export interface EmptyStateProps {
  /** The primary "nothing here yet" line. */
  title: string;
  /** Optional supporting hint under the title. */
  hint?: ReactNode;
  /** Override the default inbox icon. */
  icon?: ReactNode;
  /** Optional call-to-action button. */
  action?: { label: string; onClick: () => void };
  className?: string;
}

/**
 * On-brand empty placeholder (handoff §7 stroke icon, no emoji): an icon, a title, an optional hint,
 * and an optional CTA `Button`. Static content — deliberately carries **no** ARIA live role (an empty
 * state is neither an alert nor a status). Theme-aware via tokens.
 */
export function EmptyState({ title, hint, icon, action, className }: EmptyStateProps) {
  return (
    <div className={`gx-astate gx-astate--empty${className ? ` ${className}` : ''}`}>
      <span className="gx-astate__icon" aria-hidden="true">
        {icon ?? <IconInbox size={24} />}
      </span>
      <p className="gx-astate__title">{title}</p>
      {hint && <p className="gx-astate__msg">{hint}</p>}
      {action && (
        <Button className="gx-astate__action" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
