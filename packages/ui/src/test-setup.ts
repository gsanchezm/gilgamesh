import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library's auto-cleanup only registers when a global afterEach exists.
// We run with globals off, so unmount rendered trees explicitly between tests.
afterEach(() => {
  cleanup();
});
