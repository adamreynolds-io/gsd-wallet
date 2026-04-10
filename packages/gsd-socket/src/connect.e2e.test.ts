import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { GsdConnectServer } from './server.js';
import { GsdWalletConnect } from './client.js';
import { SessionEndedError } from './errors.js';
import { createTracer } from './tracer.js';
import type {
  NodeToGsdMessage,
  GsdToNodeMessage,
  DAppRequest,
  ConnectEventPayload,
  DiagnosticEvent,
} from './protocol.js';

// ---- Port allocation --------------------------------------------------------

let nextPort = 16372;
function allocPort(): number {
  return nextPort++;
}

// ---- MockGsdExtension -------------------------------------------------------

type ApiHandler = (args: unknown[]) => unknown | Promise<unknown>;

class MockGsdExtension {
  private ws: WebSocket;
  readonly traceEvents: ConnectEventPayload[] = [];
  private readonly apiHandlers: Map<string, ApiHandler> = new Map();
  private connectSessionId: string = crypto.randomUUID();
  private activeSessionId: string | null = null;
  private openPromise: Promise<void>;
  readonly disconnectEvents: string[] = [];

  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);

    this.openPromise = new Promise((resolve) => {
      this.ws.on('open', () => {
        this.send({ type: 'CONNECTED' });
        resolve();
      });
    });

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as NodeToGsdMessage;
        this.handleMessage(msg);
      } catch {
        // malformed — ignore
      }
    });
  }

  private handleMessage(msg: NodeToGsdMessage): void {
    switch (msg.type) {
      case 'PING':
        this.send({ type: 'PONG' });
        break;

      case 'TRACE_EVENT':
        this.traceEvents.push(msg.payload);
        break;

      case 'DAPP_REQUEST':
        this.handleDappRequest(msg.requestId, msg.payload);
        break;

      case 'GSD_DISCONNECT':
        this.disconnectEvents.push(msg.sessionId);
        this.activeSessionId = null;
        break;
    }
  }

  private handleDappRequest(requestId: string, payload: DAppRequest): void {
    if (payload.type === 'GSD_CONNECT') {
      this.activeSessionId = this.connectSessionId;
      this.send({
        type: 'DAPP_RESPONSE',
        requestId,
        payload: {
          type: 'GSD_RESPONSE',
          requestId,
          result: this.connectSessionId,
        },
      });
      return;
    }

    if (payload.type === 'GSD_API_CALL') {
      const handler = this.apiHandlers.get(payload.method);
      if (!handler) {
        this.send({
          type: 'DAPP_RESPONSE',
          requestId,
          payload: {
            type: 'GSD_ERROR',
            requestId,
            error: { code: 'NOT_FOUND', reason: `No handler for ${payload.method}` },
          },
        });
        return;
      }
      void Promise.resolve()
        .then(() => handler(payload.args))
        .then((result) => {
          this.send({
            type: 'DAPP_RESPONSE',
            requestId,
            payload: { type: 'GSD_RESPONSE', requestId, result: result ?? null },
          });
        })
        .catch((err: unknown) => {
          this.send({
            type: 'DAPP_RESPONSE',
            requestId,
            payload: {
              type: 'GSD_ERROR',
              requestId,
              error: {
                code: 'HANDLER_ERROR',
                reason: err instanceof Error ? err.message : String(err),
              },
            },
          });
        });
      return;
    }

    // GSD_HINT_USAGE — acknowledge silently
    this.send({
      type: 'DAPP_RESPONSE',
      requestId,
      payload: { type: 'GSD_RESPONSE', requestId, result: null },
    });
  }

  setApiHandler(method: string, handler: ApiHandler): void {
    this.apiHandlers.set(method, handler);
  }

  setErrorHandler(method: string, code: string, reason: string): void {
    this.apiHandlers.set(method, () => {
      throw Object.assign(new Error(reason), { code });
    });
  }

  sendDiagnosticEvent(event: DiagnosticEvent): void {
    this.send({ type: 'DIAGNOSTIC_EVENT', event });
  }

  sendStateUpdate(state: unknown): void {
    this.send({ type: 'STATE_UPDATE', state });
  }

  sendSessionEnded(reason: string): void {
    this.activeSessionId = null;
    this.send({ type: 'SESSION_ENDED', reason });
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  private send(msg: GsdToNodeMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  waitForConnection(): Promise<void> {
    return this.openPromise;
  }

  close(): void {
    this.ws.close();
  }
}

// ---- Helpers ----------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(
  condition: () => boolean,
  timeoutMs = 2000,
  intervalMs = 10,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await delay(intervalMs);
  }
}

// ---- Test suite -------------------------------------------------------------

describe('GSD Connect — end-to-end', () => {
  let server: GsdConnectServer;
  let mock: MockGsdExtension;
  let client: GsdWalletConnect;
  let port: number;

  beforeEach(() => {
    port = allocPort();
  });

  afterEach(async () => {
    mock?.close();
    await server?.stop();
  });

  async function startServer(): Promise<void> {
    server = new GsdConnectServer({ port });
    await server.start();
  }

  async function connectMock(): Promise<void> {
    mock = new MockGsdExtension(port);
    await mock.waitForConnection();
    await waitFor(() => server.isGsdConnected);
  }

  // --------------------------------------------------------------------------

  it('server starts and accepts GSD extension connection', async () => {
    await startServer();
    await connectMock();
    expect(server.isGsdConnected).toBe(true);
  });

  it('connect() establishes dApp session', async () => {
    await startServer();
    client = new GsdWalletConnect({}, server);
    await connectMock();

    // We verify by checking the session is set (no error thrown)
    await client.connect('undeployed');

    // If connect() resolves without error, the mock handled GSD_CONNECT.
    // Verify a session was returned by checking the client can make an API call.
    mock.setApiHandler('getConnectionStatus', () => ({ status: 'connected' }));
    const status = await client.getConnectionStatus();
    expect(status).toEqual({ status: 'connected' });
  });

  it('getShieldedBalances() deserializes bigints', async () => {
    await startServer();
    client = new GsdWalletConnect({}, server);
    await connectMock();
    await client.connect('undeployed');

    mock.setApiHandler('getShieldedBalances', () => ({
      '0000000000000000000000000000000000000000000000000000000000000000': '1000000',
      'abcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd': '500',
    }));

    const result = await client.getShieldedBalances();
    expect(result).toEqual({
      '0000000000000000000000000000000000000000000000000000000000000000': 1000000n,
      'abcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd': 500n,
    });
  });

  it('getDustBalance() deserializes bigint fields', async () => {
    await startServer();
    client = new GsdWalletConnect({}, server);
    await connectMock();
    await client.connect('undeployed');

    mock.setApiHandler('getDustBalance', () => ({ cap: '10000', balance: '5000' }));

    const result = await client.getDustBalance();
    expect(result).toEqual({ cap: 10000n, balance: 5000n });
  });

  it('balanceUnsealedTransaction() round-trips hex', async () => {
    await startServer();
    client = new GsdWalletConnect({}, server);
    await connectMock();
    await client.connect('undeployed');

    let capturedArgs: unknown[] = [];
    mock.setApiHandler('balanceUnsealedTransaction', (args) => {
      capturedArgs = args;
      return { tx: 'deadbeef' };
    });

    const result = await client.balanceUnsealedTransaction('cafebabe');
    expect(result).toEqual({ tx: 'deadbeef' });
    // undefined is serialized to null over JSON wire
    expect(capturedArgs).toEqual(['cafebabe', null]);
  });

  it('submitTransaction() sends hex and returns txHash', async () => {
    await startServer();
    client = new GsdWalletConnect({}, server);
    await connectMock();
    await client.connect('undeployed');

    mock.setApiHandler('submitTransaction', () => '00aabbccdd112233');

    const txId = await client.submitTransaction('aabbccdd');
    expect(txId).toBe('00aabbccdd112233');
  });

  it('emitTrace() sends TRACE_EVENT to extension', async () => {
    await startServer();
    client = new GsdWalletConnect({}, server);
    await connectMock();

    client.emitTrace('info', 'test message', { key: 'value' });

    await waitFor(() => mock.traceEvents.length > 0);
    const event = mock.traceEvents[0];
    expect(event?.message).toBe('test message');
    expect(event?.level).toBe('info');
    expect(event?.data).toEqual({ key: 'value' });
  });

  it('onDiagnosticEvent() receives events from extension', async () => {
    await startServer();
    client = new GsdWalletConnect({}, server);
    await connectMock();

    const received: DiagnosticEvent[] = [];
    client.onDiagnosticEvent((ev) => received.push(ev));

    const testEvent: DiagnosticEvent = {
      id: 1,
      timestamp: Date.now(),
      level: 'info',
      category: 'connect',
      message: 'hello from extension',
    };
    mock.sendDiagnosticEvent(testEvent);

    await waitFor(() => received.length > 0);
    expect(received[0]).toEqual(testEvent);
  });

  it('onStateChange() receives state updates from extension', async () => {
    await startServer();
    client = new GsdWalletConnect({}, server);
    await connectMock();

    const states: unknown[] = [];
    client.onStateChange((s) => states.push(s));

    mock.sendStateUpdate({ synced: true, blockHeight: 42 });

    await waitFor(() => states.length > 0);
    expect(states[0]).toEqual({ synced: true, blockHeight: 42 });
  });

  it('API error propagates correctly', async () => {
    await startServer();
    client = new GsdWalletConnect({}, server);
    await connectMock();
    await client.connect('undeployed');

    mock.setApiHandler('getConfiguration', () => {
      const err = new Error('Network not configured') as Error & { code: string };
      err.code = 'NOT_CONFIGURED';
      throw err;
    });

    await expect(client.getConfiguration()).rejects.toMatchObject({
      message: 'Network not configured',
      code: 'HANDLER_ERROR',
    });
  });

  it('disconnect() sends GSD_DISCONNECT and clears session', async () => {
    await startServer();
    client = new GsdWalletConnect({}, server);
    await connectMock();
    await client.connect('undeployed');

    expect(mock.getActiveSessionId()).not.toBeNull();

    await client.disconnect();

    await waitFor(() => mock.disconnectEvents.length > 0);
    expect(mock.disconnectEvents).toHaveLength(1);
    expect(mock.getActiveSessionId()).toBeNull();
  });

  it('API calls after disconnect throw SessionEndedError', async () => {
    await startServer();
    client = new GsdWalletConnect({}, server);
    await connectMock();
    await client.connect('undeployed');

    await client.disconnect();

    await expect(client.getConnectionStatus()).rejects.toBeInstanceOf(SessionEndedError);
  });

  it('SESSION_ENDED from wallet rejects pending requests', async () => {
    await startServer();
    client = new GsdWalletConnect({}, server);
    await connectMock();
    await client.connect('undeployed');

    // Simulate SESSION_ENDED arriving while a request is in flight by
    // setting up a slow handler and then sending SESSION_ENDED before it responds.
    let resolveSlowCall!: () => void;
    const slowCallStarted = new Promise<void>((res) => {
      resolveSlowCall = res;
    });
    mock.setApiHandler('getShieldedAddresses', () => {
      resolveSlowCall();
      // Never resolves — SESSION_ENDED will cancel it
      return new Promise(() => { /* intentionally pending */ });
    });

    const apiPromise = client.getShieldedAddresses();

    // Wait for the request to reach the mock handler
    await slowCallStarted;

    // Wallet sends SESSION_ENDED
    mock.sendSessionEnded('wallet locked');

    await expect(apiPromise).rejects.toBeInstanceOf(SessionEndedError);

    // Subsequent calls also fail immediately
    await expect(client.getDustBalance()).rejects.toBeInstanceOf(SessionEndedError);
  });

  it('tracer span() emits start and end TRACE_EVENT messages', async () => {
    await startServer();
    await connectMock();

    const tracer = createTracer(server, { batchDelayMs: 10 });
    const result = await tracer.span('test-op', async () => 'result');
    expect(result).toBe('result');

    // 'test-op started' is info so it batches; 'test-op completed' is info too.
    // Flush is automatic after batchDelayMs. Wait for both events.
    await waitFor(() => mock.traceEvents.length >= 2, 2000);

    const messages = mock.traceEvents.map((e) => e.message);
    expect(messages.some((m) => m.includes('test-op started'))).toBe(true);
    expect(messages.some((m) => m.includes('test-op completed'))).toBe(true);

    const completedEvent = mock.traceEvents.find((e) =>
      e.message.includes('test-op completed'),
    );
    expect(completedEvent?.elapsed).toBeTypeOf('number');
  });
});
