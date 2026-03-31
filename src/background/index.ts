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
    emit('info', 'wallet', 'Auto-unlock: wallet ready');
  } catch (err) {
    emit('error', 'wallet', 'Auto-unlock failed', { error: String(err) });
  }
}

// Register port listeners BEFORE creating the offscreen document,
// so the offscreen's incoming port connection is handled immediately.
setupMessageRouter();

rehydrate().then(async () => {
  emit('info', 'sw', 'Service worker started', { sessionId });
  startUpdateChecker();
  await ensureOffscreenReady();
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
