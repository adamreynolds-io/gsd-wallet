/**
 * Global WebSocket lifecycle controller.
 *
 * MUST be imported before any SDK module (e.g. @polkadot/api) so the
 * wrapper is installed before WsProvider captures globalThis.WebSocket.
 *
 * The wrapper is installed as a side effect of module evaluation — ESM
 * hoists imports above inline code, so a wrapper set up in inline code
 * in worker.ts would run AFTER the SDK modules have already cached the
 * original WebSocket constructor.
 */
export const trackedWebSockets = new Set<WebSocket>();
export let blocked = false;

export function blockNewConnections(): void {
  blocked = true;
}

export function allowNewConnections(): void {
  blocked = false;
}

// Install wrapper as side effect on first import
export const OrigWebSocket = globalThis.WebSocket;

const WebSocketWrapper = function (
  this: unknown,
  ...args: ConstructorParameters<typeof WebSocket>
) {
  const ws = new OrigWebSocket(...args);
  if (blocked) {
    setTimeout(() => ws.close(), 0);
    return ws;
  }
  trackedWebSockets.add(ws);
  ws.addEventListener('close', () => trackedWebSockets.delete(ws));
  return ws;
} as unknown as typeof WebSocket;

WebSocketWrapper.prototype = OrigWebSocket.prototype;
Object.defineProperties(WebSocketWrapper, {
  CONNECTING: { value: OrigWebSocket.CONNECTING },
  OPEN: { value: OrigWebSocket.OPEN },
  CLOSING: { value: OrigWebSocket.CLOSING },
  CLOSED: { value: OrigWebSocket.CLOSED },
});

globalThis.WebSocket = WebSocketWrapper;

// Debug: confirm wrapper is active
console.log('[GSD] WebSocket wrapper installed');
