// Polyfill Node.js Buffer for Polkadot/Substrate SDK
import { Buffer } from 'buffer';
(globalThis as Record<string, unknown>)['Buffer'] = Buffer;

// Polyfill Node.js assert for @subsquid/scale-codec (used by DustAddress encoding)
if (!(globalThis as Record<string, unknown>)['assert']) {
  const assertFn = (condition: unknown, message?: string) => {
    if (!condition) throw new Error(message ?? 'Assertion failed');
  };
  assertFn.default = assertFn;
  (globalThis as Record<string, unknown>)['assert'] = assertFn;
}

// Shim DOM globals that SDK deps and Vite's modulepreload expect in service workers
if (typeof document === 'undefined') {
  const noop = () => {};
  const noopEl = {
    setAttribute: noop,
    appendChild: noop,
    removeChild: noop,
    getAttribute: () => null,
    nonce: '',
  };
  (globalThis as Record<string, unknown>)['document'] = {
    addEventListener: noop,
    removeEventListener: noop,
    createElement: () => ({ ...noopEl, onload: null, onerror: null, rel: '', href: '', crossOrigin: '' }),
    head: { ...noopEl },
    documentElement: { ...noopEl },
    getElementsByTagName: () => [],
    querySelector: () => null,
    querySelectorAll: () => [],
    prerendering: false,
  };
}
if (typeof window === 'undefined') {
  (globalThis as Record<string, unknown>)['window'] = globalThis;
}

import { setupMessageRouter } from './messageRouter';

// Initialize message routing on service worker start
setupMessageRouter();

// Log lifecycle events for debugging
console.log('[GSD] Service worker started');

// Handle install
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[GSD] Extension installed');
  } else if (details.reason === 'update') {
    console.log('[GSD] Extension updated');
  }
});
