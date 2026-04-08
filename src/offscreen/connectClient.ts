import { handleApiCall } from './connectedApiHandler';
import { OrigWebSocket } from './wsTracker';
import type { NodeToGsdMessage, GsdToNodeMessage } from '@shared/messages';
import type { DiagnosticEvent, DiagnosticLevel, SerializedWalletState, SocketState } from '@shared/types';

const DEFAULT_URL = 'ws://127.0.0.1:6372';
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 5_000;

function emitConnect(
  level: DiagnosticLevel,
  message: string,
  data?: Record<string, unknown>,
): void {
  self.postMessage({
    id: null,
    type: 'CONNECT_EVENT',
    payload: {
      level,
      message,
      data,
      timestamp: Date.now(),
    },
  });
}

let socket: WebSocket | null = null;
let targetUrl = DEFAULT_URL;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;
let socketState: SocketState = 'off';
let activeSessionId: string | null = null;

function send(msg: GsdToNodeMessage): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

function broadcastStateChange(): void {
  self.postMessage({
    id: null,
    type: 'CONNECT_EVENT',
    payload: {
      level: 'info',
      message: `Socket state: ${socketState}`,
      data: { state: socketState, sessionId: activeSessionId },
      timestamp: Date.now(),
    },
  });
  self.postMessage({
    id: null,
    type: 'SOCKET_STATE_CHANGE',
    payload: { state: socketState, sessionId: activeSessionId },
  });
}

async function handleMessage(raw: string): Promise<void> {
  let msg: NodeToGsdMessage;
  try {
    msg = JSON.parse(raw) as NodeToGsdMessage;
  } catch (e) {
    emitConnect('warn', 'Malformed WebSocket message (JSON parse failed)', {
      error: String(e),
      preview: raw.slice(0, 200),
    });
    return;
  }

  if (msg.type === 'PING') {
    send({ type: 'PONG' });
    return;
  }

  if (msg.type === 'TRACE_EVENT') {
    self.postMessage({ id: null, type: 'CONNECT_EVENT', payload: msg.payload });
    return;
  }

  if (msg.type === 'GSD_DISCONNECT') {
    if (socketState === 'active' && msg.sessionId === activeSessionId) {
      activeSessionId = null;
      socketState = 'waiting';
      broadcastStateChange();
    }
    return;
  }

  if (msg.type === 'DAPP_REQUEST') {
    const { requestId, payload } = msg;

    if (payload.type === 'GSD_CONNECT') {
      if (socketState === 'active') {
        send({
          type: 'DAPP_RESPONSE',
          requestId,
          payload: {
            type: 'GSD_ERROR',
            requestId,
            error: { code: 'SessionConflict', reason: 'Session already active' },
          },
        });
        return;
      }
      if (socketState !== 'waiting') {
        send({
          type: 'DAPP_RESPONSE',
          requestId,
          payload: {
            type: 'GSD_ERROR',
            requestId,
            error: { code: 'NotReady', reason: 'Socket not ready' },
          },
        });
        return;
      }
      const sessionId = crypto.randomUUID();
      activeSessionId = sessionId;
      socketState = 'active';
      broadcastStateChange();
      send({
        type: 'DAPP_RESPONSE',
        requestId,
        payload: { type: 'GSD_RESPONSE', requestId, result: sessionId },
      });
      return;
    }

    if (payload.type === 'GSD_API_CALL') {
      if (socketState === 'waiting') {
        send({
          type: 'DAPP_RESPONSE',
          requestId,
          payload: {
            type: 'GSD_ERROR',
            requestId,
            error: { code: 'NoSession', reason: 'No active session' },
          },
        });
        return;
      }
      if (socketState !== 'active') {
        send({
          type: 'DAPP_RESPONSE',
          requestId,
          payload: {
            type: 'GSD_ERROR',
            requestId,
            error: { code: 'NotReady', reason: 'Socket not ready' },
          },
        });
        return;
      }
      if (payload.sessionId !== activeSessionId) {
        send({
          type: 'DAPP_RESPONSE',
          requestId,
          payload: {
            type: 'GSD_ERROR',
            requestId,
            error: { code: 'InvalidSession', reason: 'Invalid session' },
          },
        });
        return;
      }
      const apiResult = await handleApiCall(payload.method, payload.args);
      if ('error' in apiResult) {
        send({
          type: 'DAPP_RESPONSE',
          requestId,
          payload: { type: 'GSD_ERROR', requestId, error: apiResult.error },
        });
      } else {
        send({
          type: 'DAPP_RESPONSE',
          requestId,
          payload: { type: 'GSD_RESPONSE', requestId, result: apiResult.result },
        });
      }
      return;
    }

    // GSD_HINT_USAGE — no-op acknowledgement
    send({
      type: 'DAPP_RESPONSE',
      requestId,
      payload: { type: 'GSD_RESPONSE', requestId, result: undefined },
    });
  }
}

function scheduleReconnect(): void {
  if (socketState === 'off') return;
  const delay = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  attempt++;
  emitConnect('debug', `Socket reconnecting in ${delay}ms`, {
    attempt, delay,
  });
  reconnectTimer = setTimeout(openSocket, delay);
}

function openSocket(): void {
  reconnectTimer = null;
  if (socketState === 'off') return;

  // Use OrigWebSocket to bypass wsTracker — the connect socket must not
  // be killed when the wallet blocks SDK connections during stop/restart.
  socket = new OrigWebSocket(targetUrl);

  socket.onopen = () => {
    attempt = 0;
    emitConnect('info', `Socket connected to ${targetUrl}`);
    send({ type: 'CONNECTED' });
  };

  socket.onmessage = (e: MessageEvent<string>) => {
    handleMessage(e.data).catch((err) => {
      emitConnect('error', 'Socket message handler error', {
        error: String(err),
      });
    });
  };

  socket.onclose = (e: CloseEvent) => {
    emitConnect('info', 'Socket closed', {
      code: e.code,
      reason: e.reason || undefined,
      wasClean: e.wasClean,
    });
    socket = null;
    if (socketState === 'active') {
      activeSessionId = null;
      socketState = 'waiting';
      broadcastStateChange();
    }
    scheduleReconnect();
  };

  socket.onerror = () => {
    emitConnect('warn', `Socket error (connecting to ${targetUrl})`, {
      attempt,
    });
    socket?.close();
  };
}

export function connect(url: string = DEFAULT_URL): void {
  targetUrl = url;
  attempt = 0;
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  socket?.close();
  socket = null;
  socketState = 'waiting';
  broadcastStateChange();
  openSocket();
}

export function disconnect(): void {
  if (socketState === 'active') {
    send({ type: 'SESSION_ENDED', reason: 'user-disconnect' });
  }
  socketState = 'off';
  activeSessionId = null;
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  socket?.close();
  socket = null;
  broadcastStateChange();
}

export function endSession(reason: string): void {
  if (socketState !== 'active') return;
  send({ type: 'SESSION_ENDED', reason });
  activeSessionId = null;
  socketState = 'waiting';
  broadcastStateChange();
}

export function getState(): SocketState {
  return socketState;
}

export function getSessionId(): string | null {
  return activeSessionId;
}

export function forwardEvent(event: DiagnosticEvent): void {
  if (socket?.readyState === WebSocket.OPEN) {
    send({ type: 'DIAGNOSTIC_EVENT', event });
  }
}

export function forwardStateUpdate(state: SerializedWalletState): void {
  if (socket?.readyState === WebSocket.OPEN) {
    send({ type: 'STATE_UPDATE', state });
  }
}
