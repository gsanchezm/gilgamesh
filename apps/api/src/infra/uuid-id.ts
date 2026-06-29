import type { IdGenerator } from '@gilgamesh/application';
import { v7 as uuidv7 } from 'uuid';

/** Time-ordered UUID v7 ids (keystone §0) — index-friendly, sortable by creation time. */
export class Uuid7IdGenerator implements IdGenerator {
  next(): string {
    return uuidv7();
  }
}
