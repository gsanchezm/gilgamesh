/** A source of the current time — injected so use cases are deterministic under test. */
export interface Clock {
  now(): Date;
}
