import { act, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { reportOffline, reportOnline } from '../lib/connection-status';
import { ConnectionStatusProvider } from './connection-status';

const BANNER = /connection lost/i;

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
}

afterEach(() => {
  setNavigatorOnline(true);
});

function mount() {
  return render(
    <ConnectionStatusProvider>
      <div>app content</div>
    </ConnectionStatusProvider>,
  );
}

describe('ConnectionStatusProvider + banner', () => {
  it('shows no banner initially when connectivity is fine', () => {
    mount();
    expect(screen.getByText('app content')).toBeTruthy();
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it('raises the banner on a network/timeout report, with role=status + aria-live=polite (AC-CONN-01/04)', () => {
    mount();
    act(() => reportOffline());
    const banner = screen.getByText(BANNER);
    expect(banner).toBeTruthy();
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    // The banner never covers the app: the routed content is still rendered alongside it.
    expect(screen.getByText('app content')).toBeTruthy();
  });

  it('clears the banner when a subsequent request succeeds (AC-CONN-02)', () => {
    mount();
    act(() => reportOffline());
    expect(screen.queryByText(BANNER)).not.toBeNull();
    act(() => reportOnline());
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it('does NOT show the banner when only online reports arrive — 4xx/5xx path (AC-CONN-03)', () => {
    mount();
    act(() => reportOnline()); // a reached-server 404/500 reports online, never offline
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it('reacts to the browser offline/online events (AC-CONN-05)', () => {
    mount();
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.queryByText(BANNER)).not.toBeNull();
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it('shows the banner at mount when navigator.onLine is false (AC-CONN-05)', () => {
    setNavigatorOnline(false);
    mount();
    expect(screen.queryByText(BANNER)).not.toBeNull();
  });

  it('is manually dismissible, and a fresh outage re-shows it (AC-CONN-04)', () => {
    mount();
    act(() => reportOffline());
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText(BANNER)).toBeNull();
    // Reconnect, then a new outage → the previously-dismissed banner shows again.
    act(() => reportOnline());
    act(() => reportOffline());
    expect(screen.queryByText(BANNER)).not.toBeNull();
  });

  it('a repeated offline report while dismissed does not re-show it (dismiss sticks for the outage)', () => {
    mount();
    act(() => reportOffline());
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    act(() => reportOffline()); // still offline, another failed request — must stay dismissed
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it('removes its window listeners on unmount (no leak / StrictMode-safe)', () => {
    const { unmount } = mount();
    unmount();
    // After unmount, a browser offline event must not throw or update a stale tree.
    expect(() => {
      window.dispatchEvent(new Event('offline'));
    }).not.toThrow();
  });
});
