import { WalletFacade, type FacadeState } from '@midnight-ntwrk/wallet-sdk-facade';
import {
  createKeystore,
  PublicKey,
  InMemoryTransactionHistoryStorage,
  UnshieldedWallet,
  type UnshieldedKeystore,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { makeServerProvingService } from '@midnight-ntwrk/wallet-sdk-capabilities';
import type { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { MidnightBech32m, DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import type {
  Environment,
  SerializedWalletState,
  SerializedUtxo,
} from '@shared/types';
import { NIGHT_TOKEN_ID } from '@shared/constants';
import { getEnvironmentConfig } from '@shared/environments';
import { emit } from './diagnosticLogger';

async function ensureOffscreenDocument(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
  });
  if (contexts.length > 0) return;
  try {
    await chrome.offscreen.createDocument({
      url: 'src/offscreen/offscreen.html',
      reasons: ['WORKERS' as chrome.offscreen.Reason],
      justification: 'Keep service worker alive during wallet sync via periodic ping',
    });
  } catch {
    // Already exists or not supported
  }
}

export interface WalletSecretKeys {
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
}

interface ActiveWallet {
  facade: WalletFacade;
  networkId: NetworkId.NetworkId;
  secretKeys: WalletSecretKeys;
  unshieldedKeystore: UnshieldedKeystore;
  environment: Environment;
  accountIndex: number;
  walletName: string;
  subscription: { unsubscribe(): void };
  latestState: FacadeState | null;
  startPromise: Promise<void> | null;
  stallCheckInterval: ReturnType<typeof setInterval> | null;
}

let activeWallet: ActiveWallet | null = null;
let stateListeners: Array<(state: SerializedWalletState) => void> = [];
let initializingPromise: Promise<void> | null = null;

export function getActiveWallet(): ActiveWallet | null {
  return activeWallet;
}

/**
 * Wait for any in-progress wallet initialization to complete.
 * API handlers must call this before using the facade to avoid
 * racing with service worker auto-unlock reinitialization.
 */
export async function waitForReady(): Promise<void> {
  if (initializingPromise) {
    emit('debug', 'wallet', 'waitForReady: blocked on initialization');
    await initializingPromise;
    emit('debug', 'wallet', 'waitForReady: initialization complete');
  }
}

export function getFacade(): WalletFacade | null {
  return activeWallet?.facade ?? null;
}

export function getSecretKeys(): WalletSecretKeys | null {
  return activeWallet?.secretKeys ?? null;
}

export function getKeystore(): UnshieldedKeystore | null {
  return activeWallet?.unshieldedKeystore ?? null;
}

export function getNetworkId(): NetworkId.NetworkId | null {
  return activeWallet?.networkId ?? null;
}

export function getEnvironment(): Environment | null {
  return activeWallet?.environment ?? null;
}

export function onStateChange(
  listener: (state: SerializedWalletState) => void,
): () => void {
  stateListeners.push(listener);
  return () => {
    stateListeners = stateListeners.filter((l) => l !== listener);
  };
}

function serializeState(
  facadeState: FacadeState,
  environment: Environment,
  accountIndex: number,
): SerializedWalletState {
  const shieldedBalances: Record<string, string> = {};
  const rawShieldedBalances = facadeState.shielded.balances;
  for (const [tokenId, amount] of Object.entries(rawShieldedBalances)) {
    shieldedBalances[tokenId] = String(amount);
  }

  const unshieldedBalances: Record<string, string> = {};
  const rawUnshieldedBalances = facadeState.unshielded.balances;
  for (const [tokenId, amount] of Object.entries(rawUnshieldedBalances)) {
    unshieldedBalances[tokenId] = String(amount);
  }

  // Use isConnected + highestIndex to determine real sync status
  // If highestIndex is 0 AND not connected, we're still initializing
  const sp = facadeState.shielded.progress;
  const shieldedSynced = sp.isConnected
    ? (Number(sp.highestRelevantWalletIndex) === 0
        ? Number(sp.highestIndex) === 0
        : Number(sp.appliedIndex) >= Number(sp.highestRelevantWalletIndex))
    : false;
  const shieldedPercent = Number(sp.highestRelevantWalletIndex) === 0
    ? (sp.isConnected ? 100 : 0)
    : (Number(sp.appliedIndex) / Number(sp.highestRelevantWalletIndex)) * 100;

  const up = facadeState.unshielded.progress;
  const unshieldedSynced = up.isConnected
    ? (Number(up.highestTransactionId) === 0 || Number(up.appliedId) >= Number(up.highestTransactionId))
    : false;
  const unshieldedPercent = Number(up.highestTransactionId) === 0
    ? (up.isConnected ? 100 : 0)
    : (Number(up.appliedId) / Number(up.highestTransactionId)) * 100;

  const dp = facadeState.dust.progress;
  const dustSynced = dp.isConnected
    ? (Number(dp.highestRelevantWalletIndex) === 0
        ? Number(dp.highestIndex) === 0
        : Number(dp.appliedIndex) >= Number(dp.highestRelevantWalletIndex))
    : false;
  const dustPercent = Number(dp.highestRelevantWalletIndex) === 0
    ? (dp.isConnected ? 100 : 0)
    : (Number(dp.appliedIndex) / Number(dp.highestRelevantWalletIndex)) * 100;

  const allConnected = sp.isConnected && up.isConnected && dp.isConnected;
  const totalApplied =
    Number(sp.appliedIndex) + Number(up.appliedId) + Number(dp.appliedIndex);
  const totalHighest =
    Number(sp.highestRelevantWalletIndex) + Number(up.highestTransactionId) + Number(dp.highestRelevantWalletIndex);
  const overallSyncPercent = totalHighest > 0
    ? Math.floor((totalApplied / totalHighest) * 100)
    : (allConnected ? 100 : 0);
  const reallySynced = facadeState.isSynced || (allConnected && shieldedSynced && unshieldedSynced && dustSynced);

  let dustBal = 0n;
  try { dustBal = facadeState.dust.balance(new Date()); } catch { /* */ }

  const nid = getEnvironmentConfig(environment).networkId;
  let shieldedAddr = '';
  let unshieldedAddr = '';
  let dustAddr = '';
  try { if (facadeState.shielded.address) shieldedAddr = MidnightBech32m.encode(nid, facadeState.shielded.address).toString(); } catch { /* */ }
  try { if (facadeState.unshielded.address) unshieldedAddr = MidnightBech32m.encode(nid, facadeState.unshielded.address).toString(); } catch { /* */ }
  try { if (facadeState.dust.publicKey) dustAddr = DustAddress.encodePublicKey(nid, facadeState.dust.publicKey); } catch (e) { console.error('[GSD] Dust address encode failed:', e); }

  // Serialize unshielded UTXOs for dust registration UI
  const utxos: SerializedUtxo[] = [];
  try {
    for (const uwm of facadeState.unshielded.availableCoins) {
      utxos.push({
        id: `${String(uwm.utxo.intentHash)}:${uwm.utxo.outputNo}`,
        value: String(uwm.utxo.value),
        tokenType: String(uwm.utxo.type),
        registered: uwm.meta.registeredForDustGeneration,
      });
    }
  } catch { /* UTXOs not yet available */ }

  return {
    status: reallySynced ? 'synced' : (allConnected ? 'syncing' : 'initializing'),
    environment,
    activeAccountIndex: accountIndex,
    shielded: {
      address: shieldedAddr,
      balances: shieldedBalances,
      coinCount: facadeState.shielded.availableCoins.length,
      syncPercent: Math.floor(shieldedPercent),
      progress: {
        applied: Number(sp.appliedIndex),
        highest: Number(sp.highestRelevantWalletIndex),
        highestIndex: Number(sp.highestIndex),
        connected: sp.isConnected,
      },
    },
    unshielded: {
      address: unshieldedAddr,
      balances: unshieldedBalances,
      utxos,
      syncPercent: Math.floor(unshieldedPercent),
      progress: {
        applied: Number(up.appliedId),
        highest: Number(up.highestTransactionId),
        highestIndex: Number(up.highestTransactionId),
        connected: up.isConnected,
      },
    },
    dust: {
      address: dustAddr,
      balance: String(dustBal),
      syncPercent: Math.floor(dustPercent),
      progress: {
        applied: Number(dp.appliedIndex),
        highest: Number(dp.highestRelevantWalletIndex),
        highestIndex: Number(dp.highestIndex),
        connected: dp.isConnected,
      },
    },
    overallSyncPercent,
    isSynced: reallySynced,
    syncPhase: reallySynced
      ? 'synced' as const
      : !allConnected
        ? 'connecting' as const
        : overallSyncPercent >= 90
          ? 'nearly-synced' as const
          : 'catching-up' as const,
    connections: {
      node: up.isConnected,
      indexer: sp.isConnected,
      prover: true, // TODO: track real prover connectivity
    },
    activeWalletName: activeWallet?.walletName ?? '',
  };
}

export function initializeWallet(
  seed: Uint8Array,
  environment: Environment,
  accountIndex: number = 0,
  walletName: string = '',
  customUrls?: {
    nodeWsUrl: string;
    indexerHttpUrl: string;
    indexerWsUrl: string;
    provingServerUrl: string;
  },
): Promise<void> {
  const doInit = async () => {
    await stopWallet();
    await initializeWalletCore(seed, environment, accountIndex, walletName, customUrls);
  };
  initializingPromise = doInit().finally(() => { initializingPromise = null; });
  return initializingPromise;
}

async function initializeWalletCore(
  seed: Uint8Array,
  environment: Environment,
  accountIndex: number = 0,
  walletName: string = '',
  customUrls?: {
    nodeWsUrl: string;
    indexerHttpUrl: string;
    indexerWsUrl: string;
    provingServerUrl: string;
  },
): Promise<void> {
  const t0 = Date.now();
  emit('info', 'wallet', `Initializing wallet`, { environment, accountIndex, walletName });

  const envConfig = getEnvironmentConfig(environment);
  const effectiveConfig = customUrls
    ? { ...envConfig, ...customUrls }
    : envConfig;

  emit('debug', 'wallet', 'Deriving HD keys');
  const hdWallet = HDWallet.fromSeed(seed);
  if (hdWallet.type !== 'seedOk') {
    emit('error', 'wallet', 'HDWallet.fromSeed failed', { type: hdWallet.type });
    throw new Error('Failed to initialize HDWallet from seed');
  }

  const derivationResult = hdWallet.hdWallet
    .selectAccount(accountIndex)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);

  if (derivationResult.type !== 'keysDerived') {
    emit('error', 'wallet', 'Key derivation failed', { type: derivationResult.type });
    throw new Error('Failed to derive keys from HD wallet');
  }

  hdWallet.hdWallet.clear();
  emit('debug', 'wallet', 'Keys derived, creating secret keys');

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(
    derivationResult.keys[Roles.Zswap],
  );
  const dustSecretKey = ledger.DustSecretKey.fromSeed(
    derivationResult.keys[Roles.Dust],
  );
  const unshieldedKeystore = createKeystore(
    derivationResult.keys[Roles.NightExternal],
    effectiveConfig.networkId,
  );

  const config = {
    networkId: effectiveConfig.networkId,
    indexerClientConnection: {
      indexerHttpUrl: effectiveConfig.indexerHttpUrl,
      indexerWsUrl: effectiveConfig.indexerWsUrl,
    },
    provingServerUrl: new URL(effectiveConfig.provingServerUrl),
    relayURL: new URL(effectiveConfig.nodeWsUrl),
    costParameters: { feeBlocksMargin: 5 },
    txHistoryStorage: new InMemoryTransactionHistoryStorage(),
  };

  emit('info', 'wallet', 'Creating WalletFacade', { networkId: effectiveConfig.networkId, indexer: effectiveConfig.indexerHttpUrl, node: effectiveConfig.nodeWsUrl, prover: effectiveConfig.provingServerUrl });
  const facadeT0 = Date.now();
  const facade = await WalletFacade.init({
    configuration: config,
    shielded: (cfg) =>
      ShieldedWallet(cfg).startWithSeed(
        derivationResult.keys[Roles.Zswap],
      ),
    unshielded: (cfg) =>
      UnshieldedWallet(cfg).startWithPublicKey(
        PublicKey.fromKeyStore(unshieldedKeystore),
      ),
    dust: (cfg) =>
      DustWallet(cfg).startWithSeed(
        derivationResult.keys[Roles.Dust],
        ledger.LedgerParameters.initialParameters().dust,
      ),
    provingService: () => makeServerProvingService({ provingServerUrl: new URL(effectiveConfig.provingServerUrl) }),
  });
  emit('info', 'wallet', 'WalletFacade.init complete', undefined, Date.now() - facadeT0);

  // --- Phase 1: Subscribe + set activeWallet (fast, unblocks UI) ---

  let lastStatus = '';
  let lastPhase = '';
  let lastProgressEmit = 0;
  let lastAppliedTotal = 0;
  let lastAdvanceTime = Date.now();
  let stallWarned = false;
  const prevConnections = { shielded: false, unshielded: false, dust: false };

  const sub = facade.state().subscribe((facadeState) => {
    if (activeWallet) {
      activeWallet.latestState = facadeState;
    }
    const serialized = serializeState(
      facadeState,
      environment,
      accountIndex,
    );

    // Emit on status transitions
    if (serialized.status !== lastStatus) {
      emit('info', 'state', `Status: ${lastStatus || '(none)'} -> ${serialized.status}`, {
        shielded: serialized.shielded.progress,
        unshielded: serialized.unshielded.progress,
        dust: serialized.dust.progress,
        syncPercent: serialized.overallSyncPercent,
      });
      lastStatus = serialized.status;
    }

    // Emit on sync phase transitions
    if (serialized.syncPhase !== lastPhase) {
      emit('info', 'sync', `Phase: ${lastPhase || '(none)'} -> ${serialized.syncPhase}`, {
        shielded: serialized.shielded.syncPercent,
        unshielded: serialized.unshielded.syncPercent,
        dust: serialized.dust.syncPercent,
      });
      lastPhase = serialized.syncPhase;
    }

    // Emit per-wallet connection changes
    const conns = {
      shielded: serialized.shielded.progress.connected,
      unshielded: serialized.unshielded.progress.connected,
      dust: serialized.dust.progress.connected,
    };
    for (const wallet of ['shielded', 'unshielded', 'dust'] as const) {
      if (conns[wallet] !== prevConnections[wallet]) {
        emit('info', 'sync', `${wallet}: ${conns[wallet] ? 'connected' : 'disconnected'}`);
        prevConnections[wallet] = conns[wallet];
      }
    }

    // Throttled progress events (every 2s)
    const now = Date.now();
    if (now - lastProgressEmit >= 2000) {
      const currentAppliedTotal =
        serialized.shielded.progress.applied +
        serialized.unshielded.progress.applied +
        serialized.dust.progress.applied;

      if (currentAppliedTotal !== lastAppliedTotal) {
        lastAppliedTotal = currentAppliedTotal;
        lastAdvanceTime = now;
        stallWarned = false;
      }

      // Detect stall: no progress for 30s while not synced
      const stallSeconds = Math.floor((now - lastAdvanceTime) / 1000);
      const isStalled = !serialized.isSynced && stallSeconds >= 30;

      if (isStalled && !stallWarned) {
        emit('warn', 'sync', `Sync stalled — no progress for ${stallSeconds}s`, {
          shielded: serialized.shielded.progress,
          unshielded: serialized.unshielded.progress,
          dust: serialized.dust.progress,
        });
        stallWarned = true;
      }

      emit('debug', 'sync', isStalled ? `Sync progress (stalled ${stallSeconds}s)` : 'Sync progress', {
        shielded: `${serialized.shielded.progress.applied}/${serialized.shielded.progress.highest} (${serialized.shielded.syncPercent}%)`,
        unshielded: `${serialized.unshielded.progress.applied}/${serialized.unshielded.progress.highest} (${serialized.unshielded.syncPercent}%)`,
        dust: `${serialized.dust.progress.applied}/${serialized.dust.progress.highest} (${serialized.dust.syncPercent}%)`,
        overall: serialized.overallSyncPercent,
      });
      lastProgressEmit = now;
    }

    // Override syncPhase if stalled
    if (!serialized.isSynced && (Date.now() - lastAdvanceTime) >= 30_000) {
      serialized.syncPhase = 'stalled';
    }

    chrome.storage.session.set({ gsdLastState: serialized });
    for (const listener of stateListeners) {
      listener(serialized);
    }
  });

  // Periodic stall detection — runs even when the observable stops emitting
  const stallCheckInterval = setInterval(() => {
    if (!activeWallet || activeWallet.facade !== facade) {
      clearInterval(stallCheckInterval);
      return;
    }
    const now = Date.now();
    const stallSeconds = Math.floor((now - lastAdvanceTime) / 1000);
    const latestSerialized = getLatestSerializedState();
    if (latestSerialized && !latestSerialized.isSynced && stallSeconds >= 30) {
      if (!stallWarned) {
        emit('warn', 'sync', `Sync stalled — no progress for ${stallSeconds}s (connection may have dropped)`, {
          shielded: latestSerialized.shielded.progress,
          unshielded: latestSerialized.unshielded.progress,
          dust: latestSerialized.dust.progress,
        });
        stallWarned = true;
      }
      latestSerialized.syncPhase = 'stalled';
      chrome.storage.session.set({ gsdLastState: latestSerialized });
      for (const listener of stateListeners) {
        listener(latestSerialized);
      }
    }
  }, 10_000);

  activeWallet = {
    facade,
    networkId: effectiveConfig.networkId,
    secretKeys: { shieldedSecretKeys, dustSecretKey },
    unshieldedKeystore,
    environment,
    accountIndex,
    walletName,
    subscription: sub,
    latestState: null,
    startPromise: null,
    stallCheckInterval,
  };

  chrome.alarms.create('gsd-keepalive', { periodInMinutes: 0.5 });

  // Keep SW alive during sync by creating an offscreen document that pings us
  ensureOffscreenDocument();
  emit('info', 'wallet', 'WalletFacade ready, starting sync in background', { environment, networkId: effectiveConfig.networkId }, Date.now() - t0);

  // Emit initial zero-progress state so popup renders immediately
  const initialState: SerializedWalletState = {
    status: 'initializing',
    environment,
    activeAccountIndex: accountIndex,
    shielded: { address: '', balances: {}, coinCount: 0, syncPercent: 0, progress: { applied: 0, highest: 0, highestIndex: 0, connected: false } },
    unshielded: { address: '', balances: {}, utxos: [], syncPercent: 0, progress: { applied: 0, highest: 0, highestIndex: 0, connected: false } },
    dust: { address: '', balance: '0', syncPercent: 0, progress: { applied: 0, highest: 0, highestIndex: 0, connected: false } },
    overallSyncPercent: 0,
    isSynced: false,
    syncPhase: 'connecting',
    connections: { node: false, indexer: false, prover: false },
    activeWalletName: walletName,
  };
  chrome.storage.session.set({ gsdLastState: initialState });
  for (const listener of stateListeners) {
    listener(initialState);
  }

  // --- Phase 2: Start facade in background (slow, non-blocking) ---

  emit('info', 'wallet', 'Starting facade (connecting to indexer/node)');
  const startT0 = Date.now();
  const startPromise = facade.start(shieldedSecretKeys, dustSecretKey)
    .then(() => {
      emit('info', 'wallet', 'facade.start complete', undefined, Date.now() - startT0);
    })
    .catch((err) => {
      emit('error', 'wallet', 'facade.start failed', { error: String(err) }, Date.now() - startT0);
    });
  activeWallet.startPromise = startPromise;
}

export async function stopWallet(): Promise<void> {
  if (activeWallet) {
    emit('info', 'wallet', 'Stopping wallet');
    activeWallet.subscription.unsubscribe();
    if (activeWallet.stallCheckInterval) {
      clearInterval(activeWallet.stallCheckInterval);
    }
    // Clear cached state so next init doesn't show stale balances
    chrome.storage.session.remove('gsdLastState');
    try {
      await activeWallet.facade.stop();
    } catch (e) {
      emit('warn', 'wallet', 'Facade stop error (ignored)', { error: String(e) });
    }
    activeWallet = null;
    chrome.alarms.clear('gsd-keepalive');
    emit('info', 'wallet', 'Wallet stopped');
  }
}

export function getLatestSerializedState(): SerializedWalletState | null {
  if (!activeWallet?.latestState) return null;
  return serializeState(
    activeWallet.latestState,
    activeWallet.environment,
    activeWallet.accountIndex,
  );
}
