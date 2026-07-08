/**
 * Connectivity reporting seam between the HTTP layer and the UI (slice 32). The HTTP primitives
 * (`getJson`/`sendJson` in `./http`) call `reportOnline()` whenever a request reaches the server —
 * ANY HTTP status, because even a 4xx/5xx error response proves connectivity — and `reportOffline()`
 * only when a request fails with a transport/timeout error (no response at all). A
 * `ConnectionStatusProvider` subscribes to translate those reports into a global banner.
 *
 * This is a tiny pub/sub, NOT a mutable status singleton: the HTTP layer only *emits*; it holds no
 * connection state and never reads it back. With no subscriber, emitting iterates an empty `Set` — a
 * pure no-op — so the slice-25 HTTP behaviour and tests are unchanged (back-compat).
 */
export type ConnectivityEvent = 'online' | 'offline';

type ConnectivityListener = (event: ConnectivityEvent) => void;

const listeners = new Set<ConnectivityListener>();

/** Subscribe to connectivity reports. Returns an unsubscribe fn (call it on unmount). */
export function subscribeConnectivity(listener: ConnectivityListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A request reached the server (any HTTP status) → connectivity is up. */
export function reportOnline(): void {
  emit('online');
}

/** A request failed with a transport/timeout error (no response at all) → connectivity is down. */
export function reportOffline(): void {
  emit('offline');
}

function emit(event: ConnectivityEvent): void {
  // Snapshot so a listener that (un)subscribes during dispatch can't corrupt the iteration.
  for (const listener of [...listeners]) listener(event);
}
