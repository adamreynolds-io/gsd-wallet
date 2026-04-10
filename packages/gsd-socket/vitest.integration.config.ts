import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.integration.test.ts'],
    setupFiles: ['test/setup-ws.ts'],
    testTimeout: 5 * 60_000,
    hookTimeout: 5 * 60_000,
    sequence: { concurrent: false },
  },
});
