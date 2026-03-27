import type { PopupRequest, PopupResponse } from '@shared/messages';
import type { SerializedWalletState } from '@shared/types';
import { executeTransfer } from '@core/transfer';
import { executeDustRegistration } from '@core/dustRegistration';
import { executeDustDeregistration } from '@core/dustDeregistration';
import { handleApiCall } from './connectedApiHandler';
import * as stateManager from './stateManager';
import * as walletManager from './walletManager';

type SendResponse = (response: PopupResponse) => void;

const connectedPorts: chrome.runtime.Port[] = [];

function broadcastState(state: SerializedWalletState): void {
  const msg: PopupResponse = { type: 'STATE_UPDATE', state };
  for (const port of connectedPorts) {
    try {
      port.postMessage(msg);
    } catch {
      // Port disconnected
    }
  }
}

export function setupMessageRouter(): void {
  walletManager.onStateChange(broadcastState);

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'gsd-popup') {
      connectedPorts.push(port);

      port.onDisconnect.addListener(() => {
        const idx = connectedPorts.indexOf(port);
        if (idx !== -1) connectedPorts.splice(idx, 1);
      });

      port.onMessage.addListener((msg: PopupRequest) => {
        handlePopupMessage(msg, (response) => {
          try {
            port.postMessage(response);
          } catch {
            // Port disconnected
          }
        });
      });

      const currentState = walletManager.getLatestSerializedState();
      if (currentState) {
        port.postMessage({
          type: 'STATE_UPDATE',
          state: currentState,
        } satisfies PopupResponse);
      }
    } else if (port.name === 'gsd-dapp') {
      // Persistent port for dApp connector (survives long proving operations)
      port.onMessage.addListener((msg) => {
        if (msg.type !== 'DAPP_REQUEST') return;
        const { requestId, payload, origin } = msg;
        console.log(`[GSD] dApp port request: ${payload?.['type']} ${payload?.['method'] ?? ''}`);

        handleDappRequest(payload, origin).then((response) => {
          console.log(`[GSD] dApp port response for ${requestId}: ${(response as Record<string, unknown>)?.['type']}`);
          try {
            port.postMessage({ requestId, payload: response });
          } catch (e) {
            console.error('[GSD] Failed to send dApp response:', e);
          }
        }).catch((e) => {
          console.error('[GSD] dApp request handler error:', e);
          try {
            port.postMessage({ requestId, payload: { type: 'GSD_ERROR', error: { code: 'InternalError', reason: String(e) } } });
          } catch { /* */ }
        });
      });
    }
  });

  // Track connected dApp sessions with TTL
  const SESSION_TTL_MS = 30 * 60 * 1000;
  const sessions = new Map<string, { origin: string; networkId: string; createdAt: number }>();

  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.createdAt > SESSION_TTL_MS) sessions.delete(id);
    }
  }, 60_000);

  // Shared dApp request handler (used by both port and one-shot messages)
  async function handleDappRequest(
    payload: Record<string, unknown>,
    origin: string,
  ): Promise<unknown> {
    if (payload['type'] === 'GSD_CONNECT') {
      const sessionId = crypto.randomUUID();
      sessions.set(sessionId, {
        origin: origin ?? (payload['origin'] as string),
        networkId: payload['networkId'] as string,
        createdAt: Date.now(),
      });
      console.log(`[GSD] dApp connected: ${origin} (session ${sessionId})`);
      return { type: 'GSD_RESPONSE', result: sessionId };
    }

    if (payload['type'] === 'GSD_API_CALL') {
      const method = payload['method'] as string;
      const args = payload['args'] as unknown[];
      const sessionId = payload['sessionId'] as string;
      const session = sessions.get(sessionId);
      if (!session) {
        return {
          type: 'GSD_ERROR',
          error: { code: 'Disconnected', reason: 'Session not found — call connect() first' },
        };
      }

      const apiResult = await handleApiCall(method, args);
      if ('error' in apiResult) {
        return { type: 'GSD_ERROR', error: apiResult.error };
      }
      return { type: 'GSD_RESPONSE', result: apiResult.result };
    }

    return {
      type: 'GSD_ERROR',
      error: { code: 'InvalidRequest', reason: `Unknown payload type: ${payload['type']}` },
    };
  }

  // One-shot messages (popup checks)
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'CHECK_HAS_WALLETS') {
      stateManager
        .walletStoreExists()
        .then((exists) => sendResponse({ type: 'HAS_WALLETS', exists }));
      return true;
    }
    return false;
  });

  // Keepalive alarm
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'gsd-keepalive') {
      // No-op
    }
  });

  // Auto-unlock on SW start if wallets exist
  stateManager.autoUnlock().then(async (unlocked) => {
    if (unlocked) {
      const info = await stateManager.getActiveWalletInfo();
      const seed = stateManager.getSeed();
      if (info && seed) {
        try {
          await walletManager.initializeWallet(seed, info.environment, 0, info.name);
        } catch (err) {
          console.error('[GSD] Auto-init failed:', err);
        }
      }
    }
  });
}

async function handlePopupMessage(
  msg: PopupRequest,
  send: SendResponse,
): Promise<void> {
  try {
    switch (msg.type) {
      case 'CHECK_HAS_WALLETS': {
        const exists = await stateManager.walletStoreExists();
        send({ type: 'HAS_WALLETS', exists });
        break;
      }

      case 'GET_STATE': {
        const state = walletManager.getLatestSerializedState();
        if (state) {
          send({ type: 'STATE_UPDATE', state });
        } else {
          const cached = await chrome.storage.session.get('gsdLastState');
          if (cached['gsdLastState']) {
            send({
              type: 'STATE_UPDATE',
              state: cached['gsdLastState'] as SerializedWalletState,
            });
          }
        }
        break;
      }

      case 'ADD_WALLET': {
        try {
          const seed = new Uint8Array(msg.seed);
          await stateManager.addWallet(msg.name, seed, msg.environment);
          await walletManager.initializeWallet(seed, msg.environment, 0, msg.name);
          send({ type: 'WALLET_ADDED', success: true });
        } catch (err) {
          send({
            type: 'WALLET_ADDED',
            success: false,
            error: err instanceof Error ? err.message : 'Failed to add wallet',
          });
        }
        break;
      }

      case 'SWITCH_WALLET': {
        try {
          const seed = await stateManager.switchWallet(msg.index);
          const info = await stateManager.getActiveWalletInfo();
          if (info) {
            await walletManager.initializeWallet(seed, info.environment, 0, info.name);
          }
        } catch (err) {
          send({
            type: 'ERROR',
            error: err instanceof Error ? err.message : 'Failed to switch wallet',
          });
        }
        break;
      }

      case 'SWITCH_ENVIRONMENT': {
        const seed = await stateManager.switchEnvironment(msg.environment);
        if (seed) {
          const swInfo = await stateManager.getActiveWalletInfo();
          await walletManager.initializeWallet(seed, msg.environment, 0, swInfo?.name ?? '');
        } else {
          // No wallet for this environment — tell popup to show import
          await walletManager.stopWallet();
          send({ type: 'ERROR', error: `No wallet for ${msg.environment}` });
        }
        break;
      }

      case 'GET_WALLETS': {
        const wallets = await stateManager.getWalletsForEnvironment(msg.environment);
        send({ type: 'WALLETS_LIST', wallets });
        break;
      }

      case 'LOCK': {
        await walletManager.stopWallet();
        stateManager.lock();
        break;
      }

      case 'CLEAR_ALL': {
        await walletManager.stopWallet();
        await stateManager.clearAll();
        break;
      }

      case 'SEND_TRANSFER': {
        const facade = walletManager.getFacade();
        const keys = walletManager.getSecretKeys();
        const keystore = walletManager.getKeystore();
        const networkId = walletManager.getNetworkId();
        if (!facade || !keys || !networkId) {
          send({ type: 'TRANSFER_RESULT', result: { success: false, error: 'Wallet not initialized' } });
          break;
        }
        const result = await executeTransfer(
          facade,
          {
            tokenType: msg.params.tokenType,
            tokenId: msg.params.tokenId,
            amount: BigInt(msg.params.amount),
            receiverAddress: msg.params.receiverAddress,
          },
          keys,
          networkId,
          keystore ?? undefined,
        );
        send({ type: 'TRANSFER_RESULT', result });
        break;
      }

      case 'DUST_REGISTER': {
        const facade2 = walletManager.getFacade();
        const keystore2 = walletManager.getKeystore();
        if (!facade2 || !keystore2) {
          send({ type: 'DUST_REGISTER_RESULT', result: { success: false, error: 'Wallet not initialized' } });
          break;
        }
        const state2 = walletManager.getActiveWallet()?.latestState;
        if (!state2) {
          send({ type: 'DUST_REGISTER_RESULT', result: { success: false, error: 'Wallet state not available' } });
          break;
        }
        const selectedUtxos = state2.unshielded.availableCoins.filter((uwm) => {
          const id = `${String(uwm.utxo.intentHash)}:${uwm.utxo.outputNo}`;
          return msg.utxoIds.includes(id);
        });
        const regResult = await executeDustRegistration(facade2, { nightUtxos: [...selectedUtxos] }, keystore2);
        send({ type: 'DUST_REGISTER_RESULT', result: regResult });
        break;
      }

      case 'DUST_DEREGISTER': {
        const facade3 = walletManager.getFacade();
        const keystore3 = walletManager.getKeystore();
        if (!facade3 || !keystore3) {
          send({ type: 'DUST_DEREGISTER_RESULT', result: { success: false, error: 'Wallet not initialized' } });
          break;
        }
        const state3 = walletManager.getActiveWallet()?.latestState;
        if (!state3) {
          send({ type: 'DUST_DEREGISTER_RESULT', result: { success: false, error: 'Wallet state not available' } });
          break;
        }
        const deregUtxos = state3.unshielded.availableCoins.filter((uwm) => {
          const id = `${String(uwm.utxo.intentHash)}:${uwm.utxo.outputNo}`;
          return msg.utxoIds.includes(id);
        });
        const deregResult = await executeDustDeregistration(facade3, { nightUtxos: [...deregUtxos] }, keystore3);
        send({ type: 'DUST_DEREGISTER_RESULT', result: deregResult });
        break;
      }

      default:
        send({ type: 'ERROR', error: 'Unknown message type' });
    }
  } catch (err) {
    send({
      type: 'ERROR',
      error: err instanceof Error ? err.message : 'Internal error',
    });
  }
}
