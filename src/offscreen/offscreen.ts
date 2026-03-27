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

console.log('[GSD] Offscreen prover document loaded');
