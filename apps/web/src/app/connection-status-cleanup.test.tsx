import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * Pins that the provider tears down its CONNECTIVITY-SEAM subscription on unmount (review S32-F1).
 * The shared provider test already covers the `window` online/offline listeners, but a leaked seam
 * listener is a silent no-op in React 18 (no throw, no DOM change), so it can't be observed there.
 * Here we mock the seam and assert the `unsubscribe` it returns is actually invoked on unmount —
 * this is what mutation-kills a cleanup that drops `unsubscribe()`.
 */
const { unsubscribe } = vi.hoisted(() => ({ unsubscribe: vi.fn() }));

vi.mock('../lib/connection-status', () => ({
  subscribeConnectivity: () => unsubscribe,
  reportOnline: () => {},
  reportOffline: () => {},
}));

// Imported AFTER the mock so the provider binds the mocked seam.
import { ConnectionStatusProvider } from './connection-status';

describe('ConnectionStatusProvider seam cleanup', () => {
  it('unsubscribes from the connectivity seam on unmount', () => {
    const { unmount } = render(
      <ConnectionStatusProvider>
        <div>app content</div>
      </ConnectionStatusProvider>,
    );
    expect(unsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
