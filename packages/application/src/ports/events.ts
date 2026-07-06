/**
 * Keystone §5 `EventBus` — the pub/sub seam behind live SSE (slice 9). In-process in-memory for
 * now (one API replica); a distributed bus (Redis pub/sub) is a later, wiring-only swap.
 */
export interface EventBus {
  publish(topic: string, e: unknown): Promise<void>;
  subscribe(topic: string, h: (e: unknown) => void): () => void;
}
