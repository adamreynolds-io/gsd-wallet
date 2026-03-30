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

import { interceptSdkConsole } from './sdkConsoleInterceptor';
import { emit, rehydrate, sessionId } from './diagnosticLogger';
import { setupMessageRouter } from './messageRouter';

// Intercept SDK console output before any SDK imports
interceptSdkConsole();

// Restore diagnostic events from previous SW lifecycle
rehydrate().then(() => {
  // Initialize message routing (triggers SDK imports via auto-unlock)
  setupMessageRouter();

  emit('info', 'sw', 'Service worker started', { sessionId });
}).catch((err) => {
  // If rehydrate fails, still start the router
  setupMessageRouter();
  emit('error', 'sw', 'Failed to rehydrate diagnostic events', { error: String(err) });
});

chrome.runtime.onInstalled.addListener((details) => {
  emit('info', 'sw', `Extension ${details.reason}`, { reason: details.reason, previousVersion: details.previousVersion });
});
