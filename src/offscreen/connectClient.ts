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

const pendingSocketRequests = new Map<string, { wsRequestId: string; timer: ReturnType<typeof setTimeout> }>();
const SOCKET_REQUEST_TTL_MS = 130_000;

function send(msg: GsdToNodeMessage): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

function broadcastStateChange(): void {
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
    const closedSessionId = activeSessionId;
    if (socketState === 'active' && msg.sessionId === activeSessionId) {
      activeSessionId = null;
      socketState = 'waiting';
      broadcastStateChange();
    }
    if (closedSessionId) {
      self.postMessage({
        id: null,
        type: 'SOCKET_DAPP_REQUEST',
        payload: {
          socketRequestId: crypto.randomUUID(),
          dappPayload: { type: 'GSD_DISCONNECT', sessionId: msg.sessionId },
          origin: 'gsd-connect',
        },
      });
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
      const socketRequestId = crypto.randomUUID();
      const origin = payload.origin ?? 'gsd-connect';
      const timer = setTimeout(() => {
        if (pendingSocketRequests.has(socketRequestId)) {
          pendingSocketRequests.delete(socketRequestId);
          send({
            type: 'DAPP_RESPONSE',
            requestId,
            payload: {
              type: 'GSD_ERROR',
              requestId,
              error: { code: 'Timeout', reason: 'Request timed out' },
            },
          });
        }
      }, SOCKET_REQUEST_TTL_MS);
      pendingSocketRequests.set(socketRequestId, { wsRequestId: requestId, timer });
      self.postMessage({
        id: null,
        type: 'SOCKET_DAPP_REQUEST',
        payload: { socketRequestId, dappPayload: payload, origin },
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
      const socketRequestId = crypto.randomUUID();
      const timer = setTimeout(() => {
        if (pendingSocketRequests.has(socketRequestId)) {
          pendingSocketRequests.delete(socketRequestId);
          send({
            type: 'DAPP_RESPONSE',
            requestId,
            payload: {
              type: 'GSD_ERROR',
              requestId,
              error: { code: 'Timeout', reason: 'Request timed out' },
            },
          });
        }
      }, SOCKET_REQUEST_TTL_MS);
      pendingSocketRequests.set(socketRequestId, { wsRequestId: requestId, timer });
      self.postMessage({
        id: null,
        type: 'SOCKET_DAPP_REQUEST',
        payload: { socketRequestId, dappPayload: payload, origin: 'gsd-connect' },
      });
      return;
    }

    // GSD_HINT_USAGE — broadcast to background
    const socketRequestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      if (pendingSocketRequests.has(socketRequestId)) {
        pendingSocketRequests.delete(socketRequestId);
        send({
          type: 'DAPP_RESPONSE',
          requestId,
          payload: {
            type: 'GSD_ERROR',
            requestId,
            error: { code: 'Timeout', reason: 'Request timed out' },
          },
        });
      }
    }, SOCKET_REQUEST_TTL_MS);
    pendingSocketRequests.set(socketRequestId, { wsRequestId: requestId, timer });
    self.postMessage({
      id: null,
      type: 'SOCKET_DAPP_REQUEST',
      payload: { socketRequestId, dappPayload: payload, origin: 'gsd-connect' },
    });
  }
}

function scheduleReconnect(): void {
  if (socketState === 'off') return;
  const delay = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  attempt++;
  reconnectTimer = setTimeout(openSocket, delay);
}

const CONNECT_TIMEOUT_MS = 10_000;

function openSocket(): void {
  reconnectTimer = null;
  if (socketState === 'off') return;

  // Use OrigWebSocket to bypass wsTracker — the connect socket must not
  // be killed when the wallet blocks SDK connections during stop/restart.
  socket = new OrigWebSocket(targetUrl);

  const connectTimeout = setTimeout(() => {
    if (socket?.readyState !== WebSocket.OPEN) {
      emitConnect('warn', `Socket connection timeout (${targetUrl})`, { attempt });
      socket?.close();
    }
  }, CONNECT_TIMEOUT_MS);

  socket.onopen = () => {
    clearTimeout(connectTimeout);
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
    clearTimeout(connectTimeout);
    socket = null;
    if (socketState === 'active') {
      const closedSessionId = activeSessionId;
      activeSessionId = null;
      socketState = 'waiting';
      broadcastStateChange();
      pendingSocketRequests.clear();
      if (closedSessionId) {
        self.postMessage({
          id: null,
          type: 'SOCKET_DAPP_REQUEST',
          payload: {
            socketRequestId: crypto.randomUUID(),
            dappPayload: { type: 'GSD_DISCONNECT', sessionId: closedSessionId },
            origin: 'gsd-connect',
          },
        });
      }
    }
    scheduleReconnect();
  };

  socket.onerror = () => {
    clearTimeout(connectTimeout);
    socket?.close();
  };
}

export function connect(url: string = DEFAULT_URL): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      emitConnect('error', 'Invalid socket URL: must use ws:// or wss://', { url });
      return;
    }
  } catch {
    emitConnect('error', 'Invalid socket URL', { url });
    return;
  }
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
  pendingSocketRequests.clear();
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const ws = socket;
  socket = null;
  ws?.close();
  broadcastStateChange();
}

export function endSession(reason: string): void {
  if (socketState !== 'active') return;
  const closedSessionId = activeSessionId;
  send({ type: 'SESSION_ENDED', reason });
  activeSessionId = null;
  socketState = 'waiting';
  pendingSocketRequests.clear();
  broadcastStateChange();
  if (closedSessionId) {
    self.postMessage({
      id: null,
      type: 'SOCKET_DAPP_REQUEST',
      payload: {
        socketRequestId: crypto.randomUUID(),
        dappPayload: { type: 'GSD_DISCONNECT', sessionId: closedSessionId },
        origin: 'gsd-connect',
      },
    });
  }
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

export function deliverResponse(socketRequestId: string, response: unknown): boolean {
  const entry = pendingSocketRequests.get(socketRequestId);
  if (!entry) return false;
  pendingSocketRequests.delete(socketRequestId);
  clearTimeout(entry.timer);

  const resp = response as Record<string, unknown>;
  if (resp?.['type'] === 'GSD_ERROR') {
    send({
      type: 'DAPP_RESPONSE',
      requestId: entry.wsRequestId,
      payload: {
        type: 'GSD_ERROR',
        requestId: entry.wsRequestId,
        error: resp['error'] as { code: string; reason: string },
      },
    });
  } else {
    send({
      type: 'DAPP_RESPONSE',
      requestId: entry.wsRequestId,
      payload: {
        type: 'GSD_RESPONSE',
        requestId: entry.wsRequestId,
        result: resp?.['result'],
      },
    });
  }
  return true;
}

export function setActiveSession(sessionId: string): void {
  activeSessionId = sessionId;
  socketState = 'active';
  broadcastStateChange();
}
