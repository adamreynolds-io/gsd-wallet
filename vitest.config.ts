import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@core': resolve(__dirname, 'src/core'),
      '@background': resolve(__dirname, 'src/background'),
      '@popup': resolve(__dirname, 'src/popup'),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
