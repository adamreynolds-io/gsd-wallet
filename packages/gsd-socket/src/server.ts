import { WebSocketServer, type WebSocket } from 'ws';
import type {
  ConnectServerConfig,
  DAppRequest,
  GsdToNodeMessage,
  NodeToGsdMessage,
  DiagnosticEvent,
  ConnectEventPayload,
} from './protocol.js';
import { SessionEndedError } from './errors.js';

export class GsdConnectServer {
  private wss: WebSocketServer | null = null;
  private gsdConnection: WebSocket | null = null;
  private readonly port: number;
  private readonly host: string;
  private readonly stateListeners: Array<(state: unknown) => void> = [];
  private readonly diagListeners: Array<(event: DiagnosticEvent) => void> = [];
  private readonly sessionEndedListeners: Array<(reason: string) => void> = [];
  private sessionActive = false;
  private readonly pendingRequests = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(config: ConnectServerConfig = {}) {
    this.port = config.port ?? 6372;
    this.host = config.host ?? '127.0.0.1';
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port: this.port, host: this.host });
      this.wss.on('listening', () => resolve());
      this.wss.on('error', (err) => reject(err));
      this.wss.on('connection', (ws) => this.handleConnection(ws));
    });
  }

  private handleConnection(ws: WebSocket): void {
    this.gsdConnection = ws;
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as GsdToNodeMessage;
        this.handleGsdMessage(msg);
      } catch (err) {
        console.warn('[gsd-connect] Malformed message from extension:', err instanceof Error ? err.message : String(err));
      }
    });
    ws.on('close', () => {
      if (this.gsdConnection === ws) {
        this.gsdConnection = null;
        this.rejectAllPending(new Error('WebSocket connection closed'));
      }
    });
  }

  private handleGsdMessage(msg: GsdToNodeMessage): void {
    switch (msg.type) {
      case 'DIAGNOSTIC_EVENT':
        for (const fn of this.diagListeners) fn(msg.event);
        break;
      case 'STATE_UPDATE':
        for (const fn of this.stateListeners) fn(msg.state);
        break;
      case 'DAPP_RESPONSE': {
        const pending = this.pendingRequests.get(msg.requestId);
        if (pending) {
          this.pendingRequests.delete(msg.requestId);
          clearTimeout(pending.timer);
          const resp = msg.payload;
          if (resp.type === 'GSD_ERROR') {
            const err = new Error(resp.error.reason) as Error & {
              code: string;
            };
            err.code = resp.error.code;
            pending.reject(err);
          } else {
            pending.resolve(resp.result);
          }
        }
        break;
      }
      case 'SESSION_ENDED': {
        this.sessionActive = false;
        const err = new SessionEndedError(msg.reason);
        this.rejectAllPending(err);
        for (const fn of this.sessionEndedListeners) fn(msg.reason);
        break;
      }
      case 'CONNECTED':
        break;
      case 'PONG':
        break;
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this.pendingRequests.delete(id);
    }
  }

  sendTraceEvent(payload: ConnectEventPayload): void {
    this.sendToGsd({ type: 'TRACE_EVENT', payload });
  }

  sendDappRequest(
    requestId: string,
    payload: DAppRequest,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Connect request ${requestId} timed out after 120s`));
      }, 120_000);
      this.pendingRequests.set(requestId, { resolve, reject, timer });
      this.sendToGsd({ type: 'DAPP_REQUEST', requestId, payload });
    });
  }

  sendDisconnect(sessionId: string): void {
    this.sessionActive = false;
    this.sendToGsd({ type: 'GSD_DISCONNECT', sessionId });
  }

  private sendToGsd(msg: NodeToGsdMessage): void {
    if (this.gsdConnection?.readyState === 1 /* OPEN */) {
      this.gsdConnection.send(JSON.stringify(msg, (_k, v) => typeof v === 'bigint' ? String(v) : v));
    }
  }

  get isGsdConnected(): boolean {
    return this.gsdConnection?.readyState === 1;
  }

  onStateChange(fn: (state: unknown) => void): () => void {
    this.stateListeners.push(fn);
    return () => {
      const idx = this.stateListeners.indexOf(fn);
      if (idx !== -1) this.stateListeners.splice(idx, 1);
    };
  }

  onDiagnosticEvent(fn: (event: DiagnosticEvent) => void): () => void {
    this.diagListeners.push(fn);
    return () => {
      const idx = this.diagListeners.indexOf(fn);
      if (idx !== -1) this.diagListeners.splice(idx, 1);
    };
  }

  onSessionEnded(fn: (reason: string) => void): () => void {
    this.sessionEndedListeners.push(fn);
    return () => {
      const idx = this.sessionEndedListeners.indexOf(fn);
      if (idx !== -1) this.sessionEndedListeners.splice(idx, 1);
    };
  }

  async stop(): Promise<void> {
    this.rejectAllPending(new Error('Connect server stopping'));
    this.gsdConnection?.close();
    this.gsdConnection = null;
    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => resolve());
        this.wss = null;
      } else {
        resolve();
      }
    });
  }
}

export function waitForExtension(
  server: GsdConnectServer,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (server.isGsdConnected) {
      resolve();
      return;
    }
    const deadline = setTimeout(() => {
      clearInterval(poll);
      reject(
        new Error(
          `GSD Wallet extension did not connect within ${timeoutMs / 1000}s.\n` +
          '  Make sure the extension is loaded and Node.js Socket is enabled:\n' +
          '  GSD Wallet popup > Settings > Node.js Socket > Enable',
        ),
      );
    }, timeoutMs);
    const poll = setInterval(() => {
      if (server.isGsdConnected) {
        clearInterval(poll);
        clearTimeout(deadline);
        resolve();
      }
    }, 300);
  });
}
