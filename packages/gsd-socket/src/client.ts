import type {
  ConnectClientConfig,
  ConnectServerConfig,
  DAppRequest,
  DiagnosticEvent,
  ConnectEventPayload,
} from './protocol.js';
import { GsdConnectServer } from './server.js';
import { SessionEndedError } from './errors.js';

let requestCounter = 0;

function nextRequestId(): string {
  return `connect-${Date.now()}-${++requestCounter}`;
}

// BigInt deserialization (mirrors inpage.ts logic)
const BIGINT_RECORD_METHODS = new Set([
  'getShieldedBalances',
  'getUnshieldedBalances',
]);

const BIGINT_FIELDS_METHODS: Record<string, string[]> = {
  getDustBalance: ['cap', 'balance'],
};

function toBigInt(value: unknown, label: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') return BigInt(value);
  throw new Error(`Cannot convert ${typeof value} to BigInt (${label})`);
}

function deserializeBigInts(
  method: string,
  result: unknown,
): unknown {
  if (
    BIGINT_RECORD_METHODS.has(method) &&
    result &&
    typeof result === 'object'
  ) {
    const converted: Record<string, bigint> = {};
    for (const [k, v] of Object.entries(
      result as Record<string, unknown>,
    )) {
      converted[k] = toBigInt(v, `${method}.${k}`);
    }
    return converted;
  }

  const fields = BIGINT_FIELDS_METHODS[method];
  if (fields && result && typeof result === 'object') {
    const obj = { ...(result as Record<string, unknown>) };
    for (const field of fields) {
      if (field in obj) {
        obj[field] = toBigInt(obj[field], `${method}.${field}`);
      }
    }
    return obj;
  }

  return result;
}

export class GsdWalletConnect {
  private server: GsdConnectServer;
  private sessionId: string | null = null;
  private sessionActive = false;
  private connecting = false;
  private readonly origin: string;
  private ownsServer: boolean;
  private unsubSessionEnded: (() => void) | null = null;

  constructor(
    config: ConnectClientConfig = {},
    server?: GsdConnectServer,
  ) {
    this.origin = config.origin ?? 'gsd-connect';
    if (server) {
      this.server = server;
      this.ownsServer = false;
    } else {
      const serverConfig: ConnectServerConfig = {};
      if (config.port !== undefined) serverConfig.port = config.port;
      if (config.host !== undefined) serverConfig.host = config.host;
      this.server = new GsdConnectServer(serverConfig);
      this.ownsServer = true;
    }
  }

  async start(): Promise<void> {
    if (this.ownsServer) {
      await this.server.start();
    }
  }

  async connect(networkId: string): Promise<void> {
    if (this.sessionActive || this.connecting) {
      throw new Error('Already connected — call disconnect() first');
    }
    this.connecting = true;
    const requestId = nextRequestId();
    const payload: DAppRequest = {
      type: 'GSD_CONNECT',
      networkId,
      origin: this.origin,
    };
    try {
      const result = await this.server.sendDappRequest(requestId, payload);
      this.sessionId = result as string;
      this.sessionActive = true;
      this.unsubSessionEnded?.();
      this.unsubSessionEnded = this.server.onSessionEnded(() => {
        this.sessionActive = false;
        this.sessionId = null;
      });
    } finally {
      this.connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    this.unsubSessionEnded?.();
    this.unsubSessionEnded = null;
    if (this.sessionActive && this.sessionId) {
      this.server.sendDisconnect(this.sessionId);
    }
    this.sessionActive = false;
    this.sessionId = null;
  }

  private async apiCall(
    method: string,
    ...args: unknown[]
  ): Promise<unknown> {
    if (!this.sessionActive || !this.sessionId) {
      throw new SessionEndedError('session is not active');
    }
    const requestId = nextRequestId();
    const payload: DAppRequest = {
      type: 'GSD_API_CALL',
      method,
      args,
      sessionId: this.sessionId,
    };
    const result = await this.server.sendDappRequest(
      requestId,
      payload,
    );
    return deserializeBigInts(method, result);
  }

  // --- WalletConnectedAPI methods ---

  async getShieldedBalances(): Promise<Record<string, bigint>> {
    return (await this.apiCall('getShieldedBalances')) as Record<
      string,
      bigint
    >;
  }

  async getUnshieldedBalances(): Promise<Record<string, bigint>> {
    return (await this.apiCall(
      'getUnshieldedBalances',
    )) as Record<string, bigint>;
  }

  async getDustBalance(): Promise<{
    cap: bigint;
    balance: bigint;
  }> {
    return (await this.apiCall('getDustBalance')) as {
      cap: bigint;
      balance: bigint;
    };
  }

  async getShieldedAddresses(): Promise<{
    shieldedAddress: string;
    shieldedCoinPublicKey: string;
    shieldedEncryptionPublicKey: string;
  }> {
    return (await this.apiCall('getShieldedAddresses')) as {
      shieldedAddress: string;
      shieldedCoinPublicKey: string;
      shieldedEncryptionPublicKey: string;
    };
  }

  async getUnshieldedAddress(): Promise<{
    unshieldedAddress: string;
  }> {
    return (await this.apiCall('getUnshieldedAddress')) as {
      unshieldedAddress: string;
    };
  }

  async getDustAddress(): Promise<{ dustAddress: string }> {
    return (await this.apiCall('getDustAddress')) as {
      dustAddress: string;
    };
  }

  async getTxHistory(
    pageNumber = 0,
    pageSize = 50,
  ): Promise<unknown[]> {
    return (await this.apiCall(
      'getTxHistory',
      pageNumber,
      pageSize,
    )) as unknown[];
  }

  async balanceUnsealedTransaction(
    txHex: string,
    options?: { payFees?: boolean },
  ): Promise<{ tx: string }> {
    return (await this.apiCall(
      'balanceUnsealedTransaction',
      txHex,
      options,
    )) as { tx: string };
  }

  async balanceSealedTransaction(
    txHex: string,
    options?: { payFees?: boolean },
  ): Promise<{ tx: string }> {
    return (await this.apiCall(
      'balanceSealedTransaction',
      txHex,
      options,
    )) as { tx: string };
  }

  async makeTransfer(
    desiredOutputs: Array<{
      kind: string;
      type: string;
      value: string | bigint;
      recipient: string;
    }>,
    options?: { payFees?: boolean },
  ): Promise<{ tx: string }> {
    return (await this.apiCall(
      'makeTransfer',
      desiredOutputs,
      options,
    )) as { tx: string };
  }

  async makeIntent(
    ...args: unknown[]
  ): Promise<{ tx: string }> {
    return (await this.apiCall(
      'makeIntent',
      ...args,
    )) as { tx: string };
  }

  async signData(
    data: string,
    options: { encoding: string; keyType: string },
  ): Promise<{
    data: string;
    signature: string;
    verifyingKey: string;
  }> {
    return (await this.apiCall('signData', data, options)) as {
      data: string;
      signature: string;
      verifyingKey: string;
    };
  }

  async submitTransaction(txHex: string): Promise<string> {
    return (await this.apiCall('submitTransaction', txHex)) as string;
  }

  async getConfiguration(): Promise<{
    indexerUri: string;
    indexerWsUri: string;
    proverServerUri: string;
    substrateNodeUri: string;
    networkId: string;
  }> {
    return (await this.apiCall('getConfiguration')) as {
      indexerUri: string;
      indexerWsUri: string;
      proverServerUri: string;
      substrateNodeUri: string;
      networkId: string;
    };
  }

  async getConnectionStatus(): Promise<{
    status: string;
    networkId?: string;
  }> {
    return (await this.apiCall('getConnectionStatus')) as {
      status: string;
      networkId?: string;
    };
  }

  async hintUsage(methodNames: string[]): Promise<void> {
    await this.apiCall('hintUsage', methodNames);
  }

  // --- Trace events (Node.js -> GSD DiagnosticsPanel) ---

  emitTrace(
    level: ConnectEventPayload['level'],
    message: string,
    data?: unknown,
    elapsed?: number,
  ): void {
    this.server.sendTraceEvent({
      level,
      message,
      ...(data !== undefined ? { data } : {}),
      ...(elapsed !== undefined ? { elapsed } : {}),
      timestamp: Date.now(),
    });
  }

  // --- Event subscriptions (GSD -> Node.js) ---

  onStateChange(fn: (state: unknown) => void): () => void {
    return this.server.onStateChange(fn);
  }

  onDiagnosticEvent(
    fn: (event: DiagnosticEvent) => void,
  ): () => void {
    return this.server.onDiagnosticEvent(fn);
  }

  get isGsdConnected(): boolean {
    return this.server.isGsdConnected;
  }

  onSessionEnded(handler: (reason: string) => void): () => void {
    return this.server.onSessionEnded(handler);
  }

  // --- Lifecycle ---

  async close(): Promise<void> {
    await this.disconnect();
    if (this.ownsServer) {
      await this.server.stop();
    }
  }
}
