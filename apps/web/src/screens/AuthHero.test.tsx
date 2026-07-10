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
  vi.restoreAllMocks(); // restore the window.addEventListener/removeEventListener spies below
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

describe('AuthHero resize handling (redraw on viewport change)', () => {
  it('registers a window resize listener and removes it on unmount (animated path)', () => {
    stubRaf();
    stubReducedMotion(false);
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = render(<AuthHero />);
    const resizeAdd = addSpy.mock.calls.find(([type]) => type === 'resize');
    expect(resizeAdd, 'a resize listener is registered').toBeDefined();
    const handler = resizeAdd![1];

    unmount();
    expect(removeSpy).toHaveBeenCalledWith('resize', handler); // same handler reference torn down
  });

  it('still registers + removes the resize listener under prefers-reduced-motion', () => {
    // The reduced-motion branch draws a single static frame and returns early — the resize listener
    // (and its cleanup) is exactly what keeps that lone frame sized after a rotate/resize.
    const { raf } = stubRaf();
    stubReducedMotion(true);
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = render(<AuthHero />);
    expect(raf).not.toHaveBeenCalled(); // no animation loop under reduced motion (audit #11)
    const resizeAdd = addSpy.mock.calls.find(([type]) => type === 'resize');
    expect(resizeAdd, 'a resize listener is registered even under reduced motion').toBeDefined();

    unmount();
    expect(removeSpy).toHaveBeenCalledWith('resize', resizeAdd![1]);
  });
});
