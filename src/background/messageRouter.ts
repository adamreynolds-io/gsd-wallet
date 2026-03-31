import type { PopupRequest, PopupResponse } from '@shared/messages';
import type { DiagnosticEvent, SerializedWalletState, TransactionResult, TxHistoryEntry } from '@shared/types';
import { getCachedUpdate } from './updateChecker';
import * as stateManager from './stateManager';
import * as offscreenClient from './offscreenClient';
import { PORT_NAME as OFFSCREEN_PORT_NAME } from './offscreenClient';
import { emit, onEvent } from './diagnosticLogger';

type SendResponse = (response: PopupResponse) => void;

const connectedPorts: chrome.runtime.Port[] = [];
const sessions = new Map<string, { origin: string; networkId: string; createdAt: number }>();

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
  // Relay state updates and diagnostic events from offscreen to popup ports
  offscreenClient.onBroadcast((broadcast) => {
    if (broadcast.type === 'STATE_UPDATE') {
      const state = broadcast.payload as SerializedWalletState;
      // Cache in session storage for new popup connections
      chrome.storage.session.set({ gsdLastState: state });
      broadcastState(state);
    }
    if (broadcast.type === 'DIAGNOSTIC_EVENT') {
      const msg: PopupResponse = {
        type: 'DIAGNOSTIC_EVENT',
        event: broadcast.payload as DiagnosticEvent,
      };
      for (const port of connectedPorts) {
        try { port.postMessage(msg); } catch { /* */ }
      }
    }
  });

  // Broadcast SW-side diagnostic events to popup ports
  onEvent((event) => {
    const msg: PopupResponse = { type: 'DIAGNOSTIC_EVENT', event };
    for (const port of connectedPorts) {
      try { port.postMessage(msg); } catch { /* */ }
    }
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === OFFSCREEN_PORT_NAME) {
      // Offscreen document initiated connection — hand the port to offscreenClient
      offscreenClient.acceptPort(port);
      return;
    }

    // One-shot command ports (no broadcasts, just request/response)
    if (port.name === 'gsd-env-switch') {
      port.onMessage.addListener((msg: PopupRequest) => {
        handlePopupMessage(msg, (response) => {
          try { port.postMessage(response); } catch { /* */ }
        });
      });
      return;
    }

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

      // Send last known state to newly connected popup
      chrome.storage.session.get('gsdLastState').then((cached) => {
        if (cached['gsdLastState']) {
          try {
            port.postMessage({
              type: 'STATE_UPDATE',
              state: cached['gsdLastState'] as SerializedWalletState,
            } satisfies PopupResponse);
          } catch { /* */ }
        }
      });

      // Notify popup if an update is available
      const update = getCachedUpdate();
      if (update?.updateAvailable) {
        port.postMessage({
          type: 'UPDATE_AVAILABLE',
          currentVersion: update.currentVersion,
          latestVersion: update.latestVersion,
          releaseUrl: update.releaseUrl,
          downloadUrl: update.downloadUrl,
        } satisfies PopupResponse);
      }
    } else if (port.name === 'gsd-dapp') {
      port.onMessage.addListener((msg) => {
        if (msg.type !== 'DAPP_REQUEST') return;
        const { requestId, payload, origin } = msg;
        emit('info', 'dapp', `dApp request: ${payload?.['type']} ${payload?.['method'] ?? ''}`, {
          requestId, type: payload?.['type'], method: payload?.['method'], origin,
        });

        handleDappRequest(payload, origin).then((response) => {
          emit('debug', 'dapp', `dApp response: ${requestId}`, {
            requestId, responseType: (response as Record<string, unknown>)?.['type'],
          });
          try {
            port.postMessage({ requestId, payload: response });
          } catch (e) {
            emit('error', 'dapp', `Failed to send dApp response`, { requestId, error: String(e) });
          }
        }).catch((e) => {
          emit('error', 'error', `dApp request handler error`, { requestId, error: String(e) });
          try {
            port.postMessage({
              requestId,
              payload: { type: 'GSD_ERROR', error: { code: 'InternalError', reason: String(e) } },
            });
          } catch { /* */ }
        });
      });
    }
  });

  // Track connected dApp sessions with TTL
  const SESSION_TTL_MS = 30 * 60 * 1000;
  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.createdAt > SESSION_TTL_MS) sessions.delete(id);
    }
  }, 60_000);

  // One-shot messages (popup checks before port is established)
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'CHECK_HAS_WALLETS') {
      stateManager
        .walletStoreExists()
        .then((exists) => sendResponse({ type: 'HAS_WALLETS', exists }));
      return true;
    }
    return false;
  });
}

async function isDisclaimerAccepted(): Promise<boolean> {
  const result = await chrome.storage.local.get('gsdDisclaimerAccepted');
  return result['gsdDisclaimerAccepted'] === true;
}

async function handleDappRequest(
  payload: Record<string, unknown>,
  origin: string,
): Promise<unknown> {
  if (!(await isDisclaimerAccepted())) {
    return {
      type: 'GSD_ERROR',
      error: {
        code: 'NotReady',
        reason: 'Wallet disclaimer has not been accepted. Open the wallet popup first.',
      },
    };
  }

  if (payload['type'] === 'GSD_CONNECT') {
    await offscreenClient.waitForReady();
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, {
      origin: origin ?? (payload['origin'] as string),
      networkId: payload['networkId'] as string,
      createdAt: Date.now(),
    });
    emit('info', 'dapp', `dApp connected: ${origin}`, {
      sessionId, networkId: payload['networkId'], origin,
    });
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

    const apiResult = await offscreenClient.request('DAPP_API_CALL', { method, args }) as
      | { result: unknown }
      | { error: { code: string; reason: string } };

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
        const state = await offscreenClient.request('GET_STATE', null)
          .catch(() => null) as SerializedWalletState | null;
        if (state) {
          send({ type: 'STATE_UPDATE', state });
          break;
        }
        // Offscreen not ready — try session storage cache
        const cached = await chrome.storage.session.get('gsdLastState');
        if (cached['gsdLastState']) {
          send({
            type: 'STATE_UPDATE',
            state: cached['gsdLastState'] as SerializedWalletState,
          });
          break;
        }
        // Nothing available — send an empty initializing state so popup doesn't hang
        send({
          type: 'STATE_UPDATE',
          state: {
            status: 'initializing',
            environment: (await stateManager.getActiveWalletInfo())?.environment ?? 'undeployed',
            activeAccountIndex: 0,
            shielded: { address: '', balances: {}, coinCount: 0, syncPercent: 0, progress: { applied: 0, highest: 0, highestIndex: 0, connected: false } },
            unshielded: { address: '', balances: {}, utxos: [], syncPercent: 0, progress: { applied: 0, highest: 0, highestIndex: 0, connected: false } },
            dust: { address: '', balance: '0', syncPercent: 0, progress: { applied: 0, highest: 0, highestIndex: 0, connected: false } },
            overallSyncPercent: 0,
            isSynced: false,
            syncPhase: 'connecting',
            connections: { node: false, indexer: false, prover: false },
            activeWalletName: (await stateManager.getActiveWalletInfo())?.name ?? '',
          } as SerializedWalletState,
        });
        break;
      }

      case 'ADD_WALLET': {
        try {
          const seed = new Uint8Array(msg.seed);
          await stateManager.addWallet(msg.name, seed, msg.environment);
          send({ type: 'WALLET_ADDED', success: true });
          offscreenClient.request('INIT_WALLET', {
            seed: Array.from(seed),
            environment: msg.environment,
            accountIndex: 0,
            walletName: msg.name,
          }).catch((err) => {
            emit('error', 'wallet', 'Wallet init failed after ADD_WALLET', { error: String(err) });
          });
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
            await offscreenClient.request('STOP_WALLET', null);
            await offscreenClient.request('INIT_WALLET', {
              seed: Array.from(seed),
              environment: info.environment,
              accountIndex: 0,
              walletName: info.name,
            });
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
        // Invalidate all dApp sessions — they hold the old networkId
        const sessionCount = sessions.size;
        sessions.clear();
        if (sessionCount > 0) {
          emit('info', 'dapp', `Cleared ${sessionCount} dApp sessions on environment switch`);
        }

        const seed = await stateManager.switchEnvironment(msg.environment);
        if (seed) {
          const swInfo = await stateManager.getActiveWalletInfo();
          try {
            await offscreenClient.request('STOP_WALLET', null);
            await offscreenClient.request('INIT_WALLET', {
              seed: Array.from(seed),
              environment: msg.environment,
              accountIndex: 0,
              walletName: swInfo?.name ?? '',
              customUrls: msg.customUrls,
            });
          } catch (err) {
            send({
              type: 'ERROR',
              error: err instanceof Error ? err.message : 'Failed to initialize wallet',
            });
          }
        } else {
          // No wallet for this environment — stop and tell popup to show import
          await offscreenClient.request('STOP_WALLET', null).catch(() => { /* best effort */ });
          send({ type: 'ERROR', error: `No wallet for ${msg.environment}` });
        }
        break;
      }

      case 'GET_WALLETS': {
        const wallets = await stateManager.getWalletsForEnvironment(msg.environment);
        send({ type: 'WALLETS_LIST', wallets });
        break;
      }

      case 'GET_ALL_WALLETS': {
        const result = await stateManager.getAllWalletsGrouped();
        send({ type: 'ALL_WALLETS', ...result });
        break;
      }

      case 'DELETE_WALLET': {
        try {
          const info = await stateManager.getActiveWalletInfo();
          const wasActive = info?.walletIndex === msg.index;
          await stateManager.deleteWallet(msg.index);
          if (wasActive) {
            await offscreenClient.request('STOP_WALLET', null);
            const newInfo = await stateManager.getActiveWalletInfo();
            if (newInfo) {
              const store = await stateManager.getStore();
              const entry = store.wallets[newInfo.walletIndex];
              const seed = stateManager.getSeed() ?? (entry ? new Uint8Array(entry.seed) : null);
              if (!seed) break;
              await offscreenClient.request('INIT_WALLET', {
                seed: Array.from(seed),
                environment: newInfo.environment,
                accountIndex: 0,
                walletName: newInfo.name,
              });
            }
          }
          send({ type: 'WALLET_DELETED', success: true });
        } catch (err) {
          send({
            type: 'WALLET_DELETED',
            success: false,
            error: err instanceof Error ? err.message : 'Failed to delete',
          });
        }
        break;
      }

      case 'GET_WALLET_SEED': {
        const store = await stateManager.getStore();
        const entry = store.wallets[msg.index];
        if (entry) {
          const hex = Array.from(entry.seed, (b) => b.toString(16).padStart(2, '0')).join('');
          send({ type: 'WALLET_SEED', seedHex: hex });
        }
        break;
      }

      case 'LOCK': {
        await offscreenClient.request('STOP_WALLET', null);
        stateManager.lock();
        break;
      }

      case 'GET_TX_HISTORY': {
        const entries = await offscreenClient.request('GET_TX_HISTORY', null) as TxHistoryEntry[];
        send({ type: 'TX_HISTORY', entries });
        break;
      }

      case 'GET_DIAGNOSTIC_BACKLOG': {
        const events = await offscreenClient.request('GET_DIAGNOSTIC_BACKLOG', null) as DiagnosticEvent[];
        send({ type: 'DIAGNOSTIC_EVENTS_BATCH', events });
        break;
      }

      case 'CLEAR_ALL': {
        await offscreenClient.request('STOP_WALLET', null);
        await stateManager.clearAll();
        break;
      }

      case 'SEND_TRANSFER': {
        const result = await offscreenClient.request('SEND_TRANSFER', msg.params) as TransactionResult;
        send({ type: 'TRANSFER_RESULT', result });
        break;
      }

      case 'DUST_REGISTER': {
        const regResult = await offscreenClient.request('DUST_REGISTER', {
          utxoIds: msg.utxoIds,
          receiverAddress: msg.receiverAddress,
        }) as TransactionResult;
        send({ type: 'DUST_REGISTER_RESULT', result: regResult });
        break;
      }

      case 'DUST_DEREGISTER': {
        const deregResult = await offscreenClient.request('DUST_DEREGISTER', {
          utxoIds: msg.utxoIds,
        }) as TransactionResult;
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
