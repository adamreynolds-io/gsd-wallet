const PORT_NAME = 'gsd-offscreen';
const HEARTBEAT_INTERVAL_MS = 10_000;
const RECONNECT_DELAY_MS = 500;

let swPort: chrome.runtime.Port | null = null;
let workerReady = false;

// Create the Web Worker that hosts the WalletFacade
const worker = new Worker(
  new URL('./worker.ts', import.meta.url),
  { type: 'module' },
);

// Relay Worker messages → SW port
worker.onmessage = (e: MessageEvent) => {
  const msg = e.data as { id: unknown; type: string; payload: unknown };

  // Track Worker readiness
  if (msg?.id === null && msg?.type === 'READY') {
    workerReady = true;
  }

  // Forward to SW port (if connected)
  if (swPort) {
    swPort.postMessage(msg);
  }
};

worker.onerror = (e: ErrorEvent) => {
  console.error('[GSD] Worker error:', e.message);
};

// Connect to SW — offscreen initiates the connection
function connectToServiceWorker(): void {
  const port = chrome.runtime.connect({ name: PORT_NAME });
  swPort = port;

  // Relay SW port messages → Worker
  port.onMessage.addListener((msg) => {
    worker.postMessage(msg);
  });

  port.onDisconnect.addListener(() => {
    if (swPort === port) swPort = null;
    // SW may have restarted — reconnect
    setTimeout(connectToServiceWorker, RECONNECT_DELAY_MS);
  });

  // If Worker is already ready, signal SW immediately
  if (workerReady) {
    port.postMessage({ id: null, type: 'READY', payload: null });
  }
}

connectToServiceWorker();

// Heartbeat so SW can detect offscreen health
setInterval(() => {
  if (swPort) {
    swPort.postMessage({ id: null, type: 'HEARTBEAT', payload: null });
  }
}, HEARTBEAT_INTERVAL_MS);

console.log('[GSD] Offscreen relay loaded');
