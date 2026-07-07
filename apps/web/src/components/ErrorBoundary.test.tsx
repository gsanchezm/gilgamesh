import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

/** A child that throws during render while `throwing` is true, else renders recovered content. */
let throwing = true;
function Bomb({ message = 'boom-secret-token' }: { message?: string }) {
  if (throwing) throw new Error(message);
  return <div>recovered content</div>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    throwing = true;
    // React (dev) auto-logs a caught render error to console.error; our boundary also logs details
    // in dev. Silence the expected noise so the suite output stays clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children normally when nothing throws (transparent, no fallback)', () => {
    throwing = false;
    render(
      <ErrorBoundary>
        <div>healthy child</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('healthy child')).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('renders the fallback panel (not a crash) when a child throws during render (AC-EB-01)', () => {
    // The render must not throw out of the boundary — a bubbling error would fail this call.
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeTruthy();
  });

  it('never leaks the error message or stack into the rendered UI (AC-EB-02c)', () => {
    render(
      <ErrorBoundary>
        <Bomb message="boom-secret-token" />
      </ErrorBoundary>,
    );
    // The panel shows only a fixed generic message; the thrown text must appear nowhere in the DOM.
    expect(document.body.textContent).not.toContain('boom-secret-token');
    expect(document.body.textContent).not.toMatch(/at Bomb|Error:/);
    // Details still go to the console in dev (the spy captured them).
    expect(console.error).toHaveBeenCalled();
  });

  it('recovers in place: "Try again" clears the error and re-mounts the children (AC-EB-02b)', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeTruthy();

    // The next render of the child succeeds; the reset action must re-mount it.
    throwing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('recovered content')).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('offers a full-page reload action wired to window.location.reload (AC-EB-02b)', () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, reload },
    });
    try {
      render(
        <ErrorBoundary>
          <Bomb />
        </ErrorBoundary>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('keeps sibling shell chrome (outside the boundary) rendered when the content crashes (AC-EB-04)', () => {
    render(
      <div>
        <nav>shell nav</nav>
        <ErrorBoundary>
          <Bomb />
        </ErrorBoundary>
      </div>,
    );
    // The shell survives: nav is still there, and only the content slot shows the fallback.
    expect(screen.getByText('shell nav')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeTruthy();
  });

  it('auto-recovers when the boundary key changes (route navigation) (AC-EB-04)', () => {
    const { rerender } = render(
      <ErrorBoundary key="/a">
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeTruthy();

    // Navigating changes the key → React remounts the boundary with fresh state.
    throwing = false;
    rerender(
      <ErrorBoundary key="/b">
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText('recovered content')).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('is accessible: alert role + heading + native focusable buttons (AC-EB-05)', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeTruthy();
    const tryAgain = screen.getByRole('button', { name: 'Try again' });
    tryAgain.focus();
    expect(document.activeElement).toBe(tryAgain);
  });

  it('pins the dark palette on the fallback root when alwaysDark is set (pre-auth top-level)', () => {
    render(
      <ErrorBoundary alwaysDark>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert').getAttribute('data-theme')).toBe('dark');
  });

  it('does NOT pin data-theme when alwaysDark is not set (inner, theme-aware)', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert').getAttribute('data-theme')).toBeNull();
  });

  it('supports a custom fallback render-prop receiving the reset callback', () => {
    render(
      <ErrorBoundary fallback={({ reset }) => <button onClick={reset}>custom recover</button>}>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: 'custom recover' })).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();

    throwing = false;
    fireEvent.click(screen.getByRole('button', { name: 'custom recover' }));
    expect(screen.getByText('recovered content')).toBeTruthy();
  });
});
