/** Generates unique identifiers (UUID v7 adapter in infra). */
export interface IdGenerator {
  next(): string;
}
