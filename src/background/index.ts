import { emit, rehydrate, sessionId } from './diagnosticLogger';
import { setupMessageRouter } from './messageRouter';
import { startUpdateChecker } from './updateChecker';
import * as offscreenClient from './offscreenClient';
import * as stateManager from './stateManager';

async function ensureOffscreenReady(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
  });

  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: 'src/offscreen/offscreen.html',
      reasons: ['WORKERS' as chrome.offscreen.Reason],
      justification: 'Host Midnight SDK (WalletFacade) with persistent WebSocket connections',
    });
  }

  // The offscreen document initiates the port connection to the SW
  // when its script loads. setupMessageRouter wires it to offscreenClient.
  // Wait for the offscreen to signal READY over that port.
  await offscreenClient.waitForReady();
}

const AUTO_UNLOCK_CONNECT_TIMEOUT_MS = 15_000;

async function autoUnlockWallet(): Promise<void> {
  emit('info', 'wallet', 'Auto-unlock: checking for existing wallets');
  const unlocked = await stateManager.autoUnlock();
  if (!unlocked) {
    emit('debug', 'wallet', 'Auto-unlock: no wallets found');
    return;
  }

  const info = await stateManager.getActiveWalletInfo();
  const seed = stateManager.getSeed();
  if (!info || !seed) return;

  try {
    emit('info', 'wallet', 'Auto-unlock: initializing wallet', {
      environment: info.environment,
      name: info.name,
    });
    await offscreenClient.request('INIT_WALLET', {
      seed: Array.from(seed),
      environment: info.environment,
      accountIndex: 0,
      walletName: info.name,
    });

    const connected = await waitForConnection(AUTO_UNLOCK_CONNECT_TIMEOUT_MS);
    if (connected) {
      emit('info', 'wallet', 'Auto-unlock: wallet ready');
      return;
    }

    emit('warn', 'wallet', 'Auto-unlock: connection timed out', {
      environment: info.environment,
    });

    // Stop the unreachable wallet (triggers WS force-close)
    await offscreenClient.request('STOP_WALLET', {});

    // Try falling back to mainnet if we weren't already on it
    if (info.environment !== 'mainnet') {
      const mainnetSeed = await stateManager.switchEnvironment('mainnet');
      if (mainnetSeed) {
        const mainnetInfo = await stateManager.getActiveWalletInfo();
        emit('info', 'wallet', 'Auto-unlock: falling back to mainnet', {
          name: mainnetInfo?.name,
        });
        await offscreenClient.request('INIT_WALLET', {
          seed: Array.from(mainnetSeed),
          environment: 'mainnet',
          accountIndex: 0,
          walletName: mainnetInfo?.name ?? 'Mainnet',
        });
        emit('info', 'wallet', 'Auto-unlock: mainnet fallback ready');
        return;
      }
    }

    emit('warn', 'wallet', 'Auto-unlock: no reachable wallet found');
  } catch (err) {
    emit('error', 'wallet', 'Auto-unlock failed', { error: String(err) });
  }
}

/**
 * Polls offscreen for wallet state until at least one stream connects
 * or the timeout expires. Returns true if connected, false if timed out.
 */
async function waitForConnection(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const pollMs = 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    try {
      const state = await offscreenClient.request('GET_STATE', {}) as {
        connections?: { node: boolean; indexer: boolean };
      } | null;
      if (state?.connections?.node || state?.connections?.indexer) {
        return true;
      }
    } catch {
      // Offscreen not ready yet — keep polling
    }
  }
  return false;
}

// Register port listeners BEFORE creating the offscreen document,
// so the offscreen's incoming port connection is handled immediately.
setupMessageRouter();

rehydrate().then(async () => {
  emit('info', 'sw', 'Service worker started', { sessionId });
  startUpdateChecker();
  await ensureOffscreenReady();

  // Auto-connect socket if previously enabled
  const socketConfigResult = await chrome.storage.local.get('gsdSocketConfig');
  const socketCfg = socketConfigResult['gsdSocketConfig'] as { url?: string; enabled?: boolean } | undefined;
  if (socketCfg?.enabled && socketCfg.url) {
    offscreenClient.request('SET_CONNECT_URL', { url: socketCfg.url }).catch(() => {
      emit('warn', 'connect', 'Socket auto-connect failed');
    });
  }

  await autoUnlockWallet();
}).catch((err) => {
  emit('error', 'sw', 'Failed during SW init', { error: String(err) });
});

chrome.runtime.onInstalled.addListener((details) => {
  emit('info', 'sw', `Extension ${details.reason}`, {
    reason: details.reason,
    previousVersion: details.previousVersion,
  });
});
