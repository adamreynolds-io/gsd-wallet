import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import wasm from 'vite-plugin-wasm';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import manifest from './manifest.json';

const facadePkg = JSON.parse(
  readFileSync(
    resolve(__dirname, 'node_modules/@midnight-ntwrk/wallet-sdk-facade/package.json'),
    'utf-8',
  ),
) as { version: string };

export default defineConfig({
  plugins: [wasm(), react(), crx({ manifest })],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@core': resolve(__dirname, 'src/core'),
      '@background': resolve(__dirname, 'src/background'),
      '@popup': resolve(__dirname, 'src/popup'),
      buffer: 'buffer/',
      assert: 'assert/',
    },
  },
  define: {
    'global': 'globalThis',
    '__SDK_FACADE_VERSION__': JSON.stringify(facadePkg.version),
  },
  build: {
    target: 'es2022',
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        offscreen: resolve(__dirname, 'src/offscreen/offscreen.html'),
      },
    },
  },
  worker: {
    plugins: () => [wasm()],
    format: 'es',
  },
});
