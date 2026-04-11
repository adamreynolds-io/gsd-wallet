// Polyfill Node.js Buffer for Polkadot/Substrate SDK — MUST be first
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

// WebSocket wrapper installed as side effect of wsTracker import.
// Must be the first import that touches globalThis.WebSocket — all
// other modules (including @polkadot/api) will see the wrapped version.
import './wsTracker';

// Console interception before SDK imports so all SDK logs are captured
import { interceptSdkConsole } from './sdkConsoleInterceptor';
interceptSdkConsole();

import { emit, getBacklog, setBroadcastFn } from './diagnosticLogger';
import { handleApiCall } from './connectedApiHandler';
import { addTxHistoryEntry, getTxHistory } from '@shared/storage';
import { executeTransfer } from '@core/transfer';
import { executeDustRegistration } from '@core/dustRegistration';
import { executeDustDeregistration } from '@core/dustDeregistration';
import * as walletManager from './walletManager';
import * as connectClient from './connectClient';
import type { TransferRequest } from '@shared/messages';
import type { TransactionResult } from '@shared/types';

// Wire diagnostic events to postMessage to main thread and GSD Connect
setBroadcastFn((event) => {
  self.postMessage({ id: null, type: 'DIAGNOSTIC_EVENT', payload: event });
  connectClient.forwardEvent(event);
});

// Wire wallet state changes to postMessage to main thread and GSD Connect
walletManager.onStateChange((state) => {
  self.postMessage({ id: null, type: 'STATE_UPDATE', payload: state });
  connectClient.forwardStateUpdate(state);
});

function sendResponse(id: string, payload: unknown): void {
  self.postMessage({ id, type: 'RESPONSE', payload });
}

function sendError(id: string, error: string): void {
  self.postMessage({ id, type: 'ERROR', payload: error });
}

async function handleRequest(msg: { id: string; type: string; payload: unknown }): Promise<void> {
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
        sendResponse(id, { success: true });
        break;
      }

      case 'STOP_WALLET': {
        await walletManager.stopWallet();
        sendResponse(id, { success: true });
        break;
      }

      case 'GET_STATE': {
        const state = walletManager.getLatestSerializedState();
        sendResponse(id, state);
        break;
      }

      case 'DAPP_API_CALL': {
        const result = await handleApiCall(
          data['method'] as string,
          data['args'] as unknown[],
        );
        sendResponse(id, result);
        break;
      }

      case 'SEND_TRANSFER': {
        await walletManager.waitForReady();
        const result = await handleTransfer(data as unknown as TransferRequest);
        sendResponse(id, result);
        break;
      }

      case 'DUST_REGISTER': {
        await walletManager.waitForReady();
        const result = await handleDustRegister(
          data['utxoIds'] as string[],
          data['receiverAddress'] as string | undefined,
        );
        sendResponse(id, result);
        break;
      }

      case 'DUST_DEREGISTER': {
        await walletManager.waitForReady();
        const result = await handleDustDeregister(data['utxoIds'] as string[]);
        sendResponse(id, result);
        break;
      }

      case 'GET_TX_HISTORY': {
        const entries = await getTxHistory(0, 0, 50);
        sendResponse(id, entries);
        break;
      }

      case 'GET_DIAGNOSTIC_BACKLOG': {
        sendResponse(id, getBacklog());
        break;
      }

      case 'EXPORT_CACHE': {
        const { exportCacheAsNdjson } = await import('./cacheImporter');
        const env = walletManager.getEnvironment();
        if (!env) { sendError(id, 'No active wallet'); break; }
        const ndjson = await exportCacheAsNdjson(env);
        sendResponse(id, ndjson);
        break;
      }

      case 'SET_CONNECT_URL': {
        const url = (data['url'] as string) || '';
        if (url) {
          connectClient.connect(url);
        } else {
          connectClient.disconnect();
        }
        sendResponse(id, { success: true });
        break;
      }

      case 'GET_CONNECT_STATUS':
      case 'GET_SOCKET_STATE': {
        sendResponse(id, { state: connectClient.getState(), sessionId: connectClient.getSessionId() });
        break;
      }

      case 'END_SOCKET_SESSION': {
        connectClient.endSession('disconnected-by-user');
        sendResponse(id, { success: true });
        break;
      }

      case 'SOCKET_DAPP_RESPONSE': {
        const { socketRequestId, response, sessionId } = data as {
          socketRequestId: string;
          response: unknown;
          sessionId?: string;
        };
        const delivered = connectClient.deliverResponse(socketRequestId, response);
        if (delivered && sessionId) {
          connectClient.setActiveSession(sessionId);
        }
        sendResponse(id, { success: true });
        break;
      }

      default:
        sendError(id, `Unknown request type: ${type}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit('error', 'error', `Request handler failed: ${type}`, { error: message });
    sendError(id, message);
  }
}

async function handleTransfer(params: TransferRequest): Promise<TransactionResult> {
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

  const selectedUtxos = wallet.latestState.unshielded.availableCoins.filter((uwm) => {
    const id = `${String(uwm.utxo.intentHash)}:${uwm.utxo.outputNo}`;
    return utxoIds.includes(id);
  });

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

async function handleDustDeregister(utxoIds: string[]): Promise<TransactionResult> {
  const facade = walletManager.getFacade();
  const keystore = walletManager.getKeystore();
  const secretKeys = walletManager.getSecretKeys();
  if (!facade || !keystore || !secretKeys) {
    return { success: false, error: 'Wallet not initialized' };
  }
  const wallet = walletManager.getActiveWallet();
  if (!wallet?.latestState) {
    return { success: false, error: 'Wallet state not available' };
  }

  const deregUtxos = wallet.latestState.unshielded.availableCoins.filter((uwm) => {
    const id = `${String(uwm.utxo.intentHash)}:${uwm.utxo.outputNo}`;
    return utxoIds.includes(id);
  });

  const result = await executeDustDeregistration(
    facade,
    { nightUtxos: [...deregUtxos] },
    keystore,
    secretKeys,
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

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;
  if (
    typeof msg === 'object' &&
    msg !== null &&
    typeof msg.id === 'string' &&
    typeof msg.type === 'string'
  ) {
    handleRequest(msg as { id: string; type: string; payload: unknown });
  }
};

// Signal readiness to the main thread
self.postMessage({ id: null, type: 'READY', payload: null });
emit('info', 'sw', 'Worker SDK host loaded');
