import type { Clock } from '@gilgamesh/application';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
