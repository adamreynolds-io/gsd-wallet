// Offscreen document for WASM-based ZK proving.
// Phase 3 will implement the full proving bridge here.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'PROVE_REQUEST') {
    // TODO: Phase 3 — load WASM prover, execute proof, return result
    sendResponse({
      type: 'PROVE_ERROR',
      id: msg.id,
      error: 'Proving not yet implemented',
    });
  }
  return true;
});

// Keep the service worker alive using a persistent port.
// Chrome MV3 kills idle SWs after ~30s. WebSocket connections don't
// count as activity. A connected port DOES keep the SW alive.
// If the port disconnects (SW killed), reconnect immediately to
// trigger a SW restart.
function connectKeepalive() {
  const port = chrome.runtime.connect({ name: 'gsd-keepalive' });
  port.onDisconnect.addListener(() => {
    // SW died — reconnect to force restart
    setTimeout(connectKeepalive, 500);
  });
}
connectKeepalive();

console.log('[GSD] Offscreen document loaded (prover + keepalive port)');
