export interface ConnectionBannerProps {
  /** Live connectivity: `false` means the last transport signal was a network/timeout failure. */
  online: boolean;
  /** The user manually dismissed the current outage's banner. */
  dismissed: boolean;
  /** Hide the banner for the rest of the current outage. */
  onDismiss: () => void;
}

/**
 * Global "connection lost" banner (slice 32). A thin, on-brand, NON-blocking bar pinned to the top of
 * the viewport that appears only while connectivity is down and not dismissed. The `role="status"` +
 * `aria-live="polite"` live region stays mounted so the insertion of the message is announced to
 * assistive tech without stealing focus. Amber `color-mix` styling reads on both dark and light (the
 * banner follows the persisted theme; it can't be unconditionally dark because an authed user may be in
 * light mode). Only the bar itself receives pointer events — it never covers or blocks the app.
 */
export function ConnectionBanner({ online, dismissed, onDismiss }: ConnectionBannerProps) {
  const visible = !online && !dismissed;
  return (
    <div className="gx-connbanner" role="status" aria-live="polite" data-visible={visible}>
      {visible && (
        <div className="gx-connbanner__bar">
          <span className="gx-connbanner__dot" aria-hidden="true" />
          <span className="gx-connbanner__msg">Connection lost — retrying…</span>
          <button
            type="button"
            className="gx-connbanner__dismiss"
            onClick={onDismiss}
            aria-label="Dismiss connection warning"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
