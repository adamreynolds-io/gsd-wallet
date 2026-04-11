import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- chrome stub ----

const mockLocalStorage = {
  get: vi.fn(),
  set: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
};

const mockSessionStorage = {
  get: vi.fn().mockResolvedValue({}),
  set: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
};

vi.stubGlobal('chrome', {
  storage: {
    local: mockLocalStorage,
    session: mockSessionStorage,
  },
  alarms: {
    create: vi.fn(),
    onAlarm: { addListener: vi.fn() },
  },
  runtime: {
    onConnect: { addListener: vi.fn() },
    onMessage: { addListener: vi.fn() },
  },
});

// ---- deterministic UUID ----

let uuidCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `session-${++uuidCounter}`,
});

// ---- module mocks ----

vi.mock('@background/offscreenClient', () => ({
  waitForReady: vi.fn().mockResolvedValue(undefined),
  request: vi.fn(),
  onBroadcast: vi.fn(),
  acceptPort: vi.fn(),
  isConnected: vi.fn().mockReturnValue(true),
  PORT_NAME: 'gsd-offscreen',
}));

vi.mock('@background/stateManager', () => ({
  walletStoreExists: vi.fn().mockResolvedValue(true),
  getActiveWalletInfo: vi.fn().mockResolvedValue(null),
  getStore: vi.fn(),
  getAllWalletsGrouped: vi.fn(),
  getWalletsForEnvironment: vi.fn(),
  addWallet: vi.fn(),
  switchWallet: vi.fn(),
  switchEnvironment: vi.fn(),
  deleteWallet: vi.fn(),
  clearAll: vi.fn(),
  getSeed: vi.fn().mockReturnValue(null),
  lock: vi.fn(),
  isUnlocked: vi.fn().mockReturnValue(false),
}));

vi.mock('@background/updateChecker', () => ({
  getCachedUpdate: vi.fn().mockReturnValue(null),
}));

vi.mock('@background/diagnosticLogger', () => ({
  emit: vi.fn(),
  onEvent: vi.fn(),
}));

// ---- helpers ----

async function freshImport() {
  vi.resetModules();
  uuidCounter = 0;
  return await import('./messageRouter');
}

function disclaimerAccepted(accepted: boolean): void {
  mockLocalStorage.get.mockResolvedValue(
    accepted ? { gsdDisclaimerAccepted: true } : {},
  );
}

// ---- tests ----

describe('handleDappRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: disclaimer accepted
    disclaimerAccepted(true);
    mockSessionStorage.get.mockResolvedValue({});
    mockSessionStorage.set.mockResolvedValue(undefined);
  });

  it('returns NotReady when disclaimer has not been accepted', async () => {
    disclaimerAccepted(false);
    const { handleDappRequest } = await freshImport();

    const result = await handleDappRequest({ type: 'GSD_CONNECT', networkId: 'dev', origin: 'http://localhost' }, 'http://localhost');

    expect(result).toEqual({
      type: 'GSD_ERROR',
      error: {
        code: 'NotReady',
        reason: expect.stringContaining('disclaimer'),
      },
    });
  });

  it('GSD_CONNECT creates a session and returns sessionId', async () => {
    const { handleDappRequest } = await freshImport();

    const result = await handleDappRequest(
      { type: 'GSD_CONNECT', networkId: 'dev', origin: 'http://localhost' },
      'http://localhost',
    );

    expect(result).toEqual({ type: 'GSD_RESPONSE', result: 'session-1' });
  });

  it('GSD_API_CALL with valid session forwards to offscreen and returns result', async () => {
    const { handleDappRequest } = await freshImport();

    // First: establish a session
    await handleDappRequest(
      { type: 'GSD_CONNECT', networkId: 'dev', origin: 'http://localhost' },
      'http://localhost',
    );

    const offscreenClient = await import('@background/offscreenClient');
    vi.mocked(offscreenClient.request).mockResolvedValueOnce({ result: 42 });

    const result = await handleDappRequest(
      { type: 'GSD_API_CALL', method: 'getShieldedBalances', args: [], sessionId: 'session-1' },
      'http://localhost',
    );

    expect(offscreenClient.request).toHaveBeenCalledWith('DAPP_API_CALL', {
      method: 'getShieldedBalances',
      args: [],
    });
    expect(result).toEqual({ type: 'GSD_RESPONSE', result: 42 });
  });

  it('GSD_API_CALL with invalid sessionId returns Disconnected error', async () => {
    const { handleDappRequest } = await freshImport();

    const result = await handleDappRequest(
      { type: 'GSD_API_CALL', method: 'getShieldedBalances', args: [], sessionId: 'nonexistent' },
      'http://localhost',
    );

    expect(result).toEqual({
      type: 'GSD_ERROR',
      error: { code: 'Disconnected', reason: expect.stringContaining('Session not found') },
    });
  });

  it('GSD_API_CALL with wrong origin returns Forbidden error', async () => {
    const { handleDappRequest } = await freshImport();

    // Establish session from origin A
    await handleDappRequest(
      { type: 'GSD_CONNECT', networkId: 'dev', origin: 'http://origin-a.com' },
      'http://origin-a.com',
    );

    // Call from origin B using session created by A
    const result = await handleDappRequest(
      { type: 'GSD_API_CALL', method: 'getShieldedBalances', args: [], sessionId: 'session-1' },
      'http://origin-b.com',
    );

    expect(result).toEqual({
      type: 'GSD_ERROR',
      error: { code: 'Forbidden', reason: expect.stringContaining('Origin mismatch') },
    });
  });

  it('GSD_HINT_USAGE returns success with undefined result', async () => {
    const { handleDappRequest } = await freshImport();

    const result = await handleDappRequest(
      { type: 'GSD_HINT_USAGE', methodNames: ['getShieldedBalances'], sessionId: 'any' },
      'http://localhost',
    );

    expect(result).toEqual({ type: 'GSD_RESPONSE', result: undefined });
  });

  it('unknown payload type returns InvalidRequest error', async () => {
    const { handleDappRequest } = await freshImport();

    const result = await handleDappRequest(
      { type: 'GSD_UNKNOWN_TYPE' },
      'http://localhost',
    );

    expect(result).toEqual({
      type: 'GSD_ERROR',
      error: { code: 'InvalidRequest', reason: expect.stringContaining('GSD_UNKNOWN_TYPE') },
    });
  });

  it('GSD_API_CALL propagates offscreen error response', async () => {
    const { handleDappRequest } = await freshImport();

    await handleDappRequest(
      { type: 'GSD_CONNECT', networkId: 'dev', origin: 'http://localhost' },
      'http://localhost',
    );

    const offscreenClient = await import('@background/offscreenClient');
    vi.mocked(offscreenClient.request).mockResolvedValueOnce({
      error: { code: 'InternalError', reason: 'wallet not ready' },
    });

    const result = await handleDappRequest(
      { type: 'GSD_API_CALL', method: 'makeTransfer', args: [], sessionId: 'session-1' },
      'http://localhost',
    );

    expect(result).toEqual({
      type: 'GSD_ERROR',
      error: { code: 'InternalError', reason: 'wallet not ready' },
    });
  });
});
