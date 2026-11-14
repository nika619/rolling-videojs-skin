import { defineConfig } from 'vitest/config';

// Unit tests cover the pure functions; the browser tests live in tests/e2e and run with Playwright.
export default defineConfig({
  test: { include: ['tests/unit/**/*.test.ts'] },
});
