import type { ReactNode } from 'react';
import { Button } from './Button';
import { IconAlert } from './icons';

export interface ErrorStateProps {
  /** Short headline. Defaults to a generic message. */
  title?: string;
  /** The human-readable error to show under the title. */
  message: ReactNode;
  /** When provided, renders a retry action that calls this handler. */
  onRetry?: () => void;
  /** Retry button copy (only used when `onRetry` is set). */
  retryLabel?: string;
  /** Override the default alert icon. */
  icon?: ReactNode;
  className?: string;
}

/**
 * On-brand failure panel (handoff §7 stroke icon, no emoji): `role="alert"` so it is announced, a
 * title + message, and an optional retry `Button`. Theme-aware via tokens; composable — the host
 * supplies the message and the retry handler.
 */
export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  retryLabel = 'Try again',
  icon,
  className,
}: ErrorStateProps) {
  return (
    <div role="alert" className={`gx-astate gx-astate--error${className ? ` ${className}` : ''}`}>
      <span className="gx-astate__icon" aria-hidden="true">
        {icon ?? <IconAlert size={24} />}
      </span>
      <p className="gx-astate__title">{title}</p>
      <p className="gx-astate__msg">{message}</p>
      {onRetry && (
        <Button variant="secondary" className="gx-astate__action" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
