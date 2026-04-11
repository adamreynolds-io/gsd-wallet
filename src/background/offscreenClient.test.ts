import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OffscreenBroadcast } from '@shared/messages';

vi.useFakeTimers();

let uuidCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `req-${++uuidCounter}`,
});

function createMockPort() {
  const messageListeners: Array<(msg: unknown) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  return {
    onMessage: {
      addListener: (fn: (msg: unknown) => void) =>
        messageListeners.push(fn),
    },
    onDisconnect: {
      addListener: (fn: () => void) => disconnectListeners.push(fn),
    },
    postMessage: vi.fn(),
    _fireMessage: (msg: unknown) =>
      messageListeners.forEach((fn) => fn(msg)),
    _fireDisconnect: () =>
      disconnectListeners.forEach((fn) => fn()),
  };
}

async function freshImport() {
  vi.resetModules();
  uuidCounter = 0;
  return await import('./offscreenClient');
}

describe('offscreenClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('acceptPort + READY', () => {
    it('waitForReady resolves after READY broadcast', async () => {
      const mod = await freshImport();
      const port = createMockPort();

      mod.acceptPort(port as unknown as chrome.runtime.Port);
      const readyPromise = mod.waitForReady();

      port._fireMessage({
        id: null,
        type: 'READY',
        payload: null,
      });

      await expect(readyPromise).resolves.toBeUndefined();
    });

    it('resets readyPromise when called twice', async () => {
      const mod = await freshImport();
      const port1 = createMockPort();
      const port2 = createMockPort();

      mod.acceptPort(port1 as unknown as chrome.runtime.Port);
      port1._fireMessage({ id: null, type: 'READY', payload: null });
      await mod.waitForReady();

      // Accept a new port — isReady should be reset
      mod.acceptPort(port2 as unknown as chrome.runtime.Port);
      expect(mod.isConnected()).toBe(true);

      const ready2 = mod.waitForReady();
      port2._fireMessage({ id: null, type: 'READY', payload: null });
      await expect(ready2).resolves.toBeUndefined();
    });
  });

  describe('request', () => {
    it('sends message via port and resolves on response', async () => {
      const mod = await freshImport();
      const port = createMockPort();
      mod.acceptPort(port as unknown as chrome.runtime.Port);

      const promise = mod.request('GET_STATE', { foo: 1 });

      expect(port.postMessage).toHaveBeenCalledWith({
        id: 'req-1',
        type: 'GET_STATE',
        payload: { foo: 1 },
      });

      port._fireMessage({
        id: 'req-1',
        type: 'RESPONSE',
        payload: { bar: 2 },
      });

      await expect(promise).resolves.toEqual({ bar: 2 });
    });

    it('rejects with Error on ERROR response', async () => {
      const mod = await freshImport();
      const port = createMockPort();
      mod.acceptPort(port as unknown as chrome.runtime.Port);

      const promise = mod.request('GET_STATE', null);

      port._fireMessage({
        id: 'req-1',
        type: 'ERROR',
        payload: 'something broke',
      });

      await expect(promise).rejects.toThrow('something broke');
    });

    it('rejects when no port is connected', async () => {
      const mod = await freshImport();

      await expect(mod.request('GET_STATE', null)).rejects.toThrow(
        'Offscreen port not connected',
      );
    });

    it('rejects on timeout after 120s', async () => {
      const mod = await freshImport();
      const port = createMockPort();
      mod.acceptPort(port as unknown as chrome.runtime.Port);

      const promise = mod.request('GET_STATE', null);

      vi.advanceTimersByTime(120_000);

      await expect(promise).rejects.toThrow('timed out after 120s');
    });

    it('rejects when max pending requests reached', async () => {
      const mod = await freshImport();
      const port = createMockPort();
      mod.acceptPort(port as unknown as chrome.runtime.Port);

      // Fire 100 requests without resolving
      const promises: Promise<unknown>[] = [];
      for (let i = 0; i < 100; i++) {
        promises.push(mod.request('GET_STATE', null));
      }

      // 101st should fail
      await expect(mod.request('GET_STATE', null)).rejects.toThrow(
        'Too many pending offscreen requests',
      );

      // Clean up pending timers
      vi.advanceTimersByTime(120_000);
      await Promise.allSettled(promises);
    });
  });

  describe('waitForReady', () => {
    it('resolves immediately when already ready', async () => {
      const mod = await freshImport();
      const port = createMockPort();
      mod.acceptPort(port as unknown as chrome.runtime.Port);
      port._fireMessage({ id: null, type: 'READY', payload: null });

      // Should resolve without needing another READY
      await expect(mod.waitForReady()).resolves.toBeUndefined();
    });

    it('rejects after 30s timeout', async () => {
      const mod = await freshImport();
      const port = createMockPort();
      mod.acceptPort(port as unknown as chrome.runtime.Port);

      const promise = mod.waitForReady();
      vi.advanceTimersByTime(30_000);

      await expect(promise).rejects.toThrow(
        'did not become ready within 30s',
      );
    });
  });

  describe('port disconnect', () => {
    it('rejects all pending requests', async () => {
      const mod = await freshImport();
      const port = createMockPort();
      mod.acceptPort(port as unknown as chrome.runtime.Port);

      const p1 = mod.request('GET_STATE', null);
      const p2 = mod.request('GET_STATE', null);

      port._fireDisconnect();

      await expect(p1).rejects.toThrow('disconnected');
      await expect(p2).rejects.toThrow('disconnected');
      expect(mod.isConnected()).toBe(false);
    });
  });

  describe('onBroadcast', () => {
    it('listeners called for non-response messages', async () => {
      const mod = await freshImport();
      const port = createMockPort();
      mod.acceptPort(port as unknown as chrome.runtime.Port);

      const listener = vi.fn();
      mod.onBroadcast(listener);

      const broadcast: OffscreenBroadcast = {
        id: null,
        type: 'STATE_UPDATE',
        payload: { status: 'synced' },
      };
      port._fireMessage(broadcast);

      expect(listener).toHaveBeenCalledWith(broadcast);
    });
  });
});
