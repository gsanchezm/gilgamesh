import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthHero } from './AuthHero';

// ---- animation-frame + media-query test doubles (audit #11) ------------------------------

function stubRaf() {
  let nextHandle = 1;
  const raf = vi.fn(() => nextHandle++); // never invokes the callback — we only observe scheduling
  const caf = vi.fn();
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', caf);
  return { raf, caf };
}

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)' ? matches : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
});

describe('AuthHero animation lifecycle (audit #11)', () => {
  it('schedules no animation frames under prefers-reduced-motion: reduce', () => {
    const { raf } = stubRaf();
    stubReducedMotion(true);
    render(<AuthHero />);
    expect(raf).not.toHaveBeenCalled();
  });

  it('pauses the loop while the tab is hidden and resumes on visible', () => {
    const { raf, caf } = stubRaf();
    stubReducedMotion(false);
    render(<AuthHero />);
    expect(raf).toHaveBeenCalledTimes(1);
    const pending = raf.mock.results[0]!.value as number;

    setHidden(true);
    expect(caf).toHaveBeenCalledWith(pending);
    expect(raf).toHaveBeenCalledTimes(1); // nothing rescheduled while hidden

    setHidden(false);
    expect(raf).toHaveBeenCalledTimes(2); // resumed
  });

  it('tears down cleanly on unmount: frame cancelled, listener removed', () => {
    const { raf, caf } = stubRaf();
    stubReducedMotion(false);
    const { unmount } = render(<AuthHero />);
    const pending = raf.mock.results.at(-1)!.value as number;

    unmount();
    expect(caf).toHaveBeenCalledWith(pending);

    // A visibility flip after unmount must not schedule anything (listener removed).
    const calls = raf.mock.calls.length;
    setHidden(true);
    setHidden(false);
    expect(raf).toHaveBeenCalledTimes(calls);
  });
});
