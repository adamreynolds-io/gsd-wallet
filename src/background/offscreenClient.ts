// SW-side port client for communicating with the offscreen document.
// The offscreen document hosts the WalletFacade (Midnight SDK).
//
// Connection direction: the OFFSCREEN initiates the port connection
// to the SW (not the other way around). This avoids a race where the
// SW tries to connect before the offscreen script has loaded.

import type {
  OffscreenBroadcast,
  OffscreenRequest,
  OffscreenRequestType,
  OffscreenResponse,
} from '@shared/messages';

export const PORT_NAME = 'gsd-offscreen';
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_PENDING_REQUESTS = 100;
const READY_TIMEOUT_MS = 30_000;

type PendingEntry = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let port: chrome.runtime.Port | null = null;
const pending = new Map<string, PendingEntry>();
const broadcastListeners: Array<(broadcast: OffscreenBroadcast) => void> = [];
let readyResolve: (() => void) | null = null;
let readyPromise: Promise<void> | null = null;
let isReady = false;

/**
 * Accept an incoming port from the offscreen document.
 * Called by the message router when it sees a `gsd-offscreen` port.
 */
export function acceptPort(incoming: chrome.runtime.Port): void {
  port = incoming;
  isReady = false;

  port.onMessage.addListener((msg: OffscreenResponse | OffscreenBroadcast) => {
    if (msg.id !== null) {
      const entry = pending.get(msg.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(msg.id);
      if (msg.type === 'ERROR') {
        entry.reject(new Error(String(msg.payload)));
      } else {
        entry.resolve(msg.payload);
      }
    } else {
      const broadcast = msg as OffscreenBroadcast;
      if (broadcast.type === 'READY') {
        isReady = true;
        if (readyResolve) {
          readyResolve();
          readyResolve = null;
        }
      }
      for (const listener of broadcastListeners) {
        listener(broadcast);
      }
    }
  });

  port.onDisconnect.addListener(() => {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Offscreen document disconnected'));
    }
    pending.clear();
    port = null;
    isReady = false;
  });
}

export function request(
  type: OffscreenRequestType,
  payload: unknown,
): Promise<unknown> {
  if (!port) throw new Error('Offscreen port not connected');
  if (pending.size >= MAX_PENDING_REQUESTS) {
    throw new Error(`Too many pending offscreen requests (${pending.size})`);
  }
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Offscreen request ${type} timed out after 120s`));
    }, REQUEST_TIMEOUT_MS);

    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
      timer,
    });

    const message: OffscreenRequest = { id, type, payload };
    port!.postMessage(message);
  });
}

export function onBroadcast(
  handler: (broadcast: OffscreenBroadcast) => void,
): void {
  broadcastListeners.push(handler);
}

export function waitForReady(): Promise<void> {
  if (isReady) return Promise.resolve();
  if (!readyPromise) {
    readyPromise = new Promise((resolve, reject) => {
      readyResolve = resolve;
      setTimeout(() => {
        if (!isReady) {
          readyResolve = null;
          reject(new Error('Offscreen document did not become ready within 30s'));
        }
      }, READY_TIMEOUT_MS);
    });
  }
  return readyPromise;
}

export function isConnected(): boolean {
  return port !== null;
}
