import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportOffline, reportOnline, subscribeConnectivity } from './connection-status';

describe('connection-status pub/sub seam', () => {
  it('delivers online/offline reports to a subscriber (AC-CONN-01/02)', () => {
    const seen: string[] = [];
    const unsubscribe = subscribeConnectivity((e) => seen.push(e));
    reportOffline();
    reportOnline();
    unsubscribe();
    expect(seen).toEqual(['offline', 'online']);
  });

  it('stops delivering after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeConnectivity(listener);
    reportOffline();
    unsubscribe();
    reportOnline();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('offline');
  });

  it('is a pure no-op when nobody is subscribed (AC-CONN-06 back-compat)', () => {
    // The HTTP layer calls these on every request; with no provider mounted they must not throw.
    expect(() => {
      reportOnline();
      reportOffline();
    }).not.toThrow();
  });

  it('fans out to every subscriber and tolerates (un)subscribe during dispatch', () => {
    const a = vi.fn();
    const unsubA = subscribeConnectivity(a);
    // b unsubscribes itself while the event is being dispatched — must not corrupt the iteration.
    const unsubB = subscribeConnectivity(() => unsubB());
    const c = vi.fn();
    const unsubC = subscribeConnectivity(c);
    reportOffline();
    expect(a).toHaveBeenCalledWith('offline');
    expect(c).toHaveBeenCalledWith('offline');
    unsubA();
    unsubC();
  });
});
