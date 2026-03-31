// Polyfill Node.js Buffer for Polkadot/Substrate SDK
import { Buffer } from 'buffer';
(globalThis as Record<string, unknown>)['Buffer'] = Buffer;

// Polyfill Node.js assert for @subsquid/scale-codec
if (!(globalThis as Record<string, unknown>)['assert']) {
  const assertFn = (condition: unknown, message?: string) => {
    if (!condition) throw new Error(message ?? 'Assertion failed');
  };
  assertFn.default = assertFn;
  (globalThis as Record<string, unknown>)['assert'] = assertFn;
}

import { interceptSdkConsole } from './sdkConsoleInterceptor';
import { emit, getBacklog, setBroadcastFn } from './diagnosticLogger';
import { handleApiCall } from './connectedApiHandler';
import { addTxHistoryEntry, getTxHistory } from '@shared/storage';
import { executeTransfer } from '@core/transfer';
import { executeDustRegistration } from '@core/dustRegistration';
import { executeDustDeregistration } from '@core/dustDeregistration';
import * as walletManager from './walletManager';
import type { TransferRequest } from '@shared/messages';
import type { TransactionResult } from '@shared/types';

interceptSdkConsole();

const PORT_NAME = 'gsd-offscreen';
const HEARTBEAT_INTERVAL_MS = 10_000;

let swPort: chrome.runtime.Port | null = null;

function sendResponse(
  port: chrome.runtime.Port,
  id: string,
  payload: unknown,
): void {
  port.postMessage({ id, type: 'RESPONSE', payload });
}

function sendError(
  port: chrome.runtime.Port,
  id: string,
  error: string,
): void {
  port.postMessage({ id, type: 'ERROR', payload: error });
}

function broadcast(
  type: string,
  payload: unknown,
): void {
  if (!swPort) return;
  swPort.postMessage({ id: null, type, payload });
}

// Wire diagnostic events to broadcast to SW for popup relay
setBroadcastFn((event) => broadcast('DIAGNOSTIC_EVENT', event));

// Subscribe to wallet state changes and relay to SW
// State broadcasts relay through SW, which caches in session storage
walletManager.onStateChange((state) => {
  broadcast('STATE_UPDATE', state);
});

async function handleRequest(
  port: chrome.runtime.Port,
  msg: { id: string; type: string; payload: unknown },
): Promise<void> {
  const { id, type, payload } = msg;
  const data = payload as Record<string, unknown>;

  try {
    switch (type) {
      case 'INIT_WALLET': {
        const seed = new Uint8Array(data['seed'] as number[]);
        try {
          await walletManager.initializeWallet(
            seed,
            data['environment'] as Parameters<typeof walletManager.initializeWallet>[1],
            (data['accountIndex'] as number) ?? 0,
            (data['walletName'] as string) ?? '',
            data['customUrls'] as Parameters<typeof walletManager.initializeWallet>[4],
          );
        } finally {
          seed.fill(0);
        }
        sendResponse(port, id, { success: true });
        break;
      }

      case 'STOP_WALLET': {
        await walletManager.stopWallet();
        sendResponse(port, id, { success: true });
        break;
      }

      case 'GET_STATE': {
        const state = walletManager.getLatestSerializedState();
        sendResponse(port, id, state);
        break;
      }

      case 'DAPP_API_CALL': {
        const result = await handleApiCall(
          data['method'] as string,
          data['args'] as unknown[],
        );
        sendResponse(port, id, result);
        break;
      }

      case 'SEND_TRANSFER': {
        const result = await handleTransfer(data as unknown as TransferRequest);
        sendResponse(port, id, result);
        break;
      }

      case 'DUST_REGISTER': {
        const result = await handleDustRegister(
          data['utxoIds'] as string[],
          data['receiverAddress'] as string | undefined,
        );
        sendResponse(port, id, result);
        break;
      }

      case 'DUST_DEREGISTER': {
        const result = await handleDustDeregister(
          data['utxoIds'] as string[],
        );
        sendResponse(port, id, result);
        break;
      }

      case 'GET_TX_HISTORY': {
        const entries = await getTxHistory(0, 0, 50);
        sendResponse(port, id, entries);
        break;
      }

      case 'GET_DIAGNOSTIC_BACKLOG': {
        sendResponse(port, id, getBacklog());
        break;
      }

      default:
        sendError(port, id, `Unknown request type: ${type}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit('error', 'error', `Request handler failed: ${type}`, { error: message });
    sendError(port, id, message);
  }
}

async function handleTransfer(
  params: TransferRequest,
): Promise<TransactionResult> {
  const facade = walletManager.getFacade();
  const keys = walletManager.getSecretKeys();
  const keystore = walletManager.getKeystore();
  const networkId = walletManager.getNetworkId();
  if (!facade || !keys || !networkId) {
    return { success: false, error: 'Wallet not initialized' };
  }

  const result = await executeTransfer(
    facade,
    {
      tokenType: params.tokenType,
      tokenId: params.tokenId,
      amount: BigInt(params.amount),
      receiverAddress: params.receiverAddress,
    },
    keys,
    networkId,
    keystore ?? undefined,
  );

  if (result.success) {
    await addTxHistoryEntry({
      txHash: result.txId,
      status: 'pending',
      timestamp: Date.now(),
      accountIndex: 0,
      type: 'transfer',
      metadata: {
        tokenType: params.tokenType,
        tokenId: params.tokenId,
        amount: params.amount,
        receiver: params.receiverAddress,
      },
    });
  }
  return result;
}

async function handleDustRegister(
  utxoIds: string[],
  _receiverAddress?: string,
): Promise<TransactionResult> {
  const facade = walletManager.getFacade();
  const keystore = walletManager.getKeystore();
  if (!facade || !keystore) {
    return { success: false, error: 'Wallet not initialized' };
  }
  const wallet = walletManager.getActiveWallet();
  if (!wallet?.latestState) {
    return { success: false, error: 'Wallet state not available' };
  }

  const selectedUtxos = wallet.latestState.unshielded.availableCoins.filter(
    (uwm) => {
      const id = `${String(uwm.utxo.intentHash)}:${uwm.utxo.outputNo}`;
      return utxoIds.includes(id);
    },
  );

  const result = await executeDustRegistration(
    facade,
    { nightUtxos: [...selectedUtxos] },
    keystore,
  );

  if (result.success) {
    await addTxHistoryEntry({
      txHash: result.txId,
      status: 'pending',
      timestamp: Date.now(),
      accountIndex: 0,
      type: 'dustReg',
      metadata: { utxoCount: selectedUtxos.length },
    });
  }
  return result;
}

async function handleDustDeregister(
  utxoIds: string[],
): Promise<TransactionResult> {
  const facade = walletManager.getFacade();
  const keystore = walletManager.getKeystore();
  if (!facade || !keystore) {
    return { success: false, error: 'Wallet not initialized' };
  }
  const wallet = walletManager.getActiveWallet();
  if (!wallet?.latestState) {
    return { success: false, error: 'Wallet state not available' };
  }

  const deregUtxos = wallet.latestState.unshielded.availableCoins.filter(
    (uwm) => {
      const id = `${String(uwm.utxo.intentHash)}:${uwm.utxo.outputNo}`;
      return utxoIds.includes(id);
    },
  );

  const result = await executeDustDeregistration(
    facade,
    { nightUtxos: [...deregUtxos] },
    keystore,
  );

  if (result.success) {
    await addTxHistoryEntry({
      txHash: result.txId,
      status: 'pending',
      timestamp: Date.now(),
      accountIndex: 0,
      type: 'dustDereg',
      metadata: { utxoCount: deregUtxos.length },
    });
  }
  return result;
}

// Connect to the SW. The offscreen initiates the port (not the SW)
// to avoid a race where the SW connects before this script has loaded.
function connectToServiceWorker(): void {
  const port = chrome.runtime.connect({ name: PORT_NAME });
  swPort = port;
  emit('info', 'sw', 'Offscreen connected to service worker');

  port.onMessage.addListener((msg) => {
    if (
      typeof msg === 'object' &&
      msg !== null &&
      typeof msg['id'] === 'string' &&
      typeof msg['type'] === 'string'
    ) {
      handleRequest(port, msg as { id: string; type: string; payload: unknown });
    }
  });

  port.onDisconnect.addListener(() => {
    if (swPort === port) swPort = null;
    emit('info', 'sw', 'Service worker disconnected from offscreen');
    // SW may have restarted — reconnect so the new SW gets a port
    setTimeout(connectToServiceWorker, 500);
  });

  // Signal readiness to the SW
  broadcast('READY', null);
}

connectToServiceWorker();

// Heartbeat so SW can detect offscreen health
setInterval(() => broadcast('HEARTBEAT', null), HEARTBEAT_INTERVAL_MS);

emit('info', 'sw', 'Offscreen SDK host loaded');
