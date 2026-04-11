/**
 * Content script: bridges inpage (page main world) <-> service worker.
 * Uses a persistent port connection to avoid Chrome's message channel timeout
 * during long-running operations like transaction proving.
 */
export {};

const INPAGE_SRC = 'gsd-wallet-inpage';
const CONTENT_SRC = 'gsd-wallet-content';

// Inject inpage.js as an external script via chrome extension URL
const script = document.createElement('script');
script.src = chrome.runtime.getURL('src/content-script/inpage.js');
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

// Maintain a persistent port to the service worker with auto-reconnect
let port: chrome.runtime.Port | null = null;
const pendingRequests = new Map<string, (response: unknown) => void>();

function connectPort(): chrome.runtime.Port {
  const p = chrome.runtime.connect({ name: 'gsd-dapp' });

  p.onMessage.addListener((msg) => {
    if (msg.requestId && pendingRequests.has(msg.requestId)) {
      const resolve = pendingRequests.get(msg.requestId)!;
      pendingRequests.delete(msg.requestId);
      resolve(msg.payload);
    }
  });

  p.onDisconnect.addListener(() => {
    port = null;
    // Don't reject pending — they'll be resent on reconnect
  });

  return p;
}

function getPort(): chrome.runtime.Port {
  if (!port) port = connectPort();
  return port;
}

function sendViaSw(requestId: string, payload: unknown, origin: string, resolve: (r: unknown) => void) {
  pendingRequests.set(requestId, resolve);

  try {
    const p = getPort();
    p.postMessage({ type: 'DAPP_REQUEST', requestId, payload, origin });
  } catch {
    // Port dead, reconnect and retry once
    port = null;
    try {
      const p = getPort();
      p.postMessage({ type: 'DAPP_REQUEST', requestId, payload, origin });
    } catch {
      pendingRequests.delete(requestId);
      resolve({
        type: 'GSD_ERROR',
        error: { code: 'Disconnected', reason: 'Cannot reach wallet service worker' },
      });
    }
  }
}

// Forward messages from inpage → service worker → inpage
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== INPAGE_SRC) return;

  const { requestId, payload } = event.data;
  if (typeof requestId !== 'string' || !requestId) return;
  if (!payload || typeof payload !== 'object') return;

  sendViaSw(requestId, payload, window.location.origin, (response) => {
    window.postMessage(
      { source: CONTENT_SRC, requestId, payload: response },
      window.location.origin,
    );
  });
});
