import { WalletFacade, type FacadeState } from '@midnight-ntwrk/wallet-sdk-facade';
import {
  createKeystore,
  PublicKey,
  InMemoryTransactionHistoryStorage,
  UnshieldedWallet,
  type UnshieldedKeystore,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { HDWallet, Roles, type Role } from '@midnight-ntwrk/wallet-sdk-hd';
import { CustomShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { V1Builder as ShieldedV1Builder, Sync as ShieldedSync } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { V1Builder as DustV1Builder, SyncService as DustSyncService } from '@midnight-ntwrk/wallet-sdk-dust-wallet/v1';
import { makeCachingShieldedSyncService, makeSkipReplayShieldedSyncCapability } from './cachingSyncService';
import { makeCachingDustSyncService, makeSkipReplayDustSyncCapability } from './cachingDustSyncService';
import { getMaxEventId } from '@shared/storage';
import { CustomDustWallet } from './customDustWallet';
import { makeServerProvingService } from '@midnight-ntwrk/wallet-sdk-capabilities';
import type { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { MidnightBech32m, DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import type {
  Environment,
  SerializedWalletState,
  SerializedUtxo,
} from '@shared/types';
import { getEnvironmentConfig } from '@shared/environments';
import { emit } from './diagnosticLogger';
import {
  saveCheckpoint,
  loadCheckpoint,
  clearCheckpoint,
} from './sdkCheckpoint';
import { importBundledCache } from './cacheImporter';

export interface WalletSecretKeys {
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
}

interface ActiveWallet {
  facade: WalletFacade;
  networkId: NetworkId.NetworkId;
  secretKeys: WalletSecretKeys;
  unshieldedKeystore: UnshieldedKeystore;
  txHistoryStorage: InMemoryTransactionHistoryStorage;
  environment: Environment;
  accountIndex: number;
  walletName: string;
  walletId: string;
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
 * racing with reinitialization.
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

  const sp = facadeState.shielded.progress;
  const shieldedSynced = sp.isConnected
    ? (Number(sp.highestRelevantWalletIndex) === 0
        ? Number(sp.highestIndex) === 0
        : Number(sp.appliedIndex) >= Number(sp.highestRelevantWalletIndex))
    : false;
  const shieldedPercent = Number(sp.highestRelevantWalletIndex) === 0
    ? (sp.isConnected ? 100 : 0)
    : Math.min(100, (Number(sp.appliedIndex) / Number(sp.highestRelevantWalletIndex)) * 100);

  const up = facadeState.unshielded.progress;
  const unshieldedSynced = up.isConnected
    ? (Number(up.highestTransactionId) === 0 || Number(up.appliedId) >= Number(up.highestTransactionId))
    : false;
  const unshieldedPercent = Number(up.highestTransactionId) === 0
    ? (up.isConnected ? 100 : 0)
    : Math.min(100, (Number(up.appliedId) / Number(up.highestTransactionId)) * 100);

  const dp = facadeState.dust.progress;
  const dustSynced = dp.isConnected
    ? (Number(dp.highestRelevantWalletIndex) === 0
        ? Number(dp.highestIndex) === 0
        : Number(dp.appliedIndex) >= Number(dp.highestRelevantWalletIndex))
    : false;
  const dustPercent = Number(dp.highestRelevantWalletIndex) === 0
    ? (dp.isConnected ? 100 : 0)
    : Math.min(100, (Number(dp.appliedIndex) / Number(dp.highestRelevantWalletIndex)) * 100);

  const allConnected = sp.isConnected && up.isConnected && dp.isConnected;
  const totalApplied =
    Number(sp.appliedIndex) + Number(up.appliedId) + Number(dp.appliedIndex);
  const totalHighest =
    Number(sp.highestRelevantWalletIndex) + Number(up.highestTransactionId) + Number(dp.highestRelevantWalletIndex);
  const overallSyncPercent = totalHighest > 0
    ? Math.min(100, Math.floor((totalApplied / totalHighest) * 100))
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
      prover: true,
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

function makeShieldedBuilder(network: string, skipCache = false, preScanned = false) {
  return new ShieldedV1Builder()
    .withDefaultTransactionType()
    .withSync(
      makeCachingShieldedSyncService(network, skipCache, preScanned),
      preScanned ? makeSkipReplayShieldedSyncCapability : ShieldedSync.makeEventsSyncCapability,
    )
    .withSerializationDefaults()
    .withTransactingDefaults()
    .withCoinSelectionDefaults()
    .withCoinsAndBalancesDefaults()
    .withTransactionHistoryDefaults()
    .withKeysDefaults();
}

function makeDustBuilder(network: string, skipCache = false, preScanned = false) {
  return new DustV1Builder()
    .withDefaultTransactionType()
    .withSync(
      makeCachingDustSyncService(network, skipCache, preScanned),
      preScanned ? makeSkipReplayDustSyncCapability : DustSyncService.makeDefaultSyncCapability,
    )
    .withSerializationDefaults()
    .withTransactingDefaults()
    .withCoinSelectionDefaults()
    .withCoinsAndBalancesDefaults()
    .withKeysDefaults();
}

const SCAN_TIMEOUT_MS = 180_000;

interface ScanResult {
  matched: boolean;
  lastEventId: number;
  maxId: number;
}

/**
 * Spawns two scan workers (one shielded, one dust) to check all cached
 * events for wallet matches in parallel on separate CPU cores.
 *
 * Each worker uses `CoreWallet.replayEvents` directly (no SDK sync
 * runtime) and processes the full event range from 0. The Merkle
 * commitment tree requires sequential insertion so chunking is not
 * possible.
 *
 * If both workers report "no matches", the wallet can skip WASM
 * deserialization entirely and fast-forward through cached events.
 *
 * Returns null if cache is empty or any worker fails.
 */
async function scanCacheForMatches(
  network: string,
  networkId: string,
  derivedKeys: Record<number, Uint8Array>,
): Promise<{ shielded: ScanResult; dust: ScanResult } | null> {
  const [shieldedMax, dustMax] = await Promise.all([
    getMaxEventId(network, 'zswap'),
    getMaxEventId(network, 'dust'),
  ]);

  if (shieldedMax === 0 && dustMax === 0) return null;

  emit('info', 'sync', 'Starting parallel cache scan', {
    network,
    shieldedMax,
    dustMax,
    workers: 2,
  });

  const t0 = Date.now();

  function spawnScanWorker(
    type: 'zswap' | 'dust',
    seed: Uint8Array,
    fromId: number,
    toId: number,
  ): Promise<{ matched: boolean; lastEventId: number; maxId: number; coinCount: number }> {
    return new Promise((resolve, reject) => {
      // Vite requires `new Worker(new URL(..., import.meta.url))` inline
      const worker = new Worker(
        new URL('./scanWorker.ts', import.meta.url),
        { type: 'module' },
      );

      const timer = setTimeout(() => {
        worker.terminate();
        reject(new Error(`Scan worker ${type} [${fromId}→${toId}] timed out`));
      }, SCAN_TIMEOUT_MS);

      worker.onmessage = (event: MessageEvent) => {
        clearTimeout(timer);
        const msg = event.data as {
          type: string;
          matched?: boolean;
          lastEventId?: number;
          maxId?: number;
          coinCount?: number;
          error?: string;
        };
        if (msg.type === 'DONE') {
          resolve({
            matched: msg.matched ?? false,
            lastEventId: msg.lastEventId ?? toId,
            maxId: msg.maxId ?? toId,
            coinCount: msg.coinCount ?? 0,
          });
        } else {
          reject(new Error(`Scan worker ${type} [${fromId}→${toId}] failed: ${msg.error ?? 'unknown'}`));
        }
        worker.terminate();
      };

      worker.onerror = (err) => {
        clearTimeout(timer);
        reject(new Error(`Scan worker error: ${err.message}`));
        worker.terminate();
      };

      worker.postMessage({
        type,
        network,
        networkId,
        seed: Array.from(seed),
        fromId,
        toId,
      });
    });
  }

  try {
    const [shieldedResult, dustResult] = await Promise.all([
      spawnScanWorker('zswap', derivedKeys[Roles.Zswap]!, 0, shieldedMax),
      spawnScanWorker('dust', derivedKeys[Roles.Dust]!, 0, dustMax),
    ]);

    emit('info', 'sync', 'Parallel scan complete', {
      elapsed: Date.now() - t0,
      shieldedMatched: shieldedResult.matched,
      dustMatched: dustResult.matched,
      shieldedCoins: shieldedResult.coinCount,
      dustCoins: dustResult.coinCount,
    });

    return {
      shielded: {
        matched: shieldedResult.matched,
        lastEventId: shieldedResult.lastEventId,
        maxId: shieldedResult.maxId,
      },
      dust: {
        matched: dustResult.matched,
        lastEventId: dustResult.lastEventId,
        maxId: dustResult.maxId,
      },
    };
  } catch (err) {
    emit('warn', 'sync', 'Parallel scan failed, falling back to sequential', {
      error: String(err),
      elapsed: Date.now() - t0,
    });
    return null;
  }
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

  // Derive a non-reversible wallet ID from the seed (never log raw seed bytes)
  const seedHash = await crypto.subtle.digest('SHA-256', seed.buffer as ArrayBuffer);
  const walletId = Array.from(new Uint8Array(seedHash).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');

  emit('debug', 'wallet', 'Deriving HD keys');
  const seedCopy = new Uint8Array(seed);
  const hdWallet = HDWallet.fromSeed(seedCopy);
  seedCopy.fill(0);
  if (hdWallet.type !== 'seedOk') {
    emit('error', 'wallet', 'HDWallet.fromSeed failed', { type: hdWallet.type });
    throw new Error('Failed to initialize HDWallet from seed');
  }

  const account = hdWallet.hdWallet.selectAccount(accountIndex);
  const deriveRoleKey = (role: Role, index = 0): Uint8Array => {
    const result = account.selectRole(role).deriveKeyAt(index);
    if (result.type === 'keyDerived') return result.key;
    if (index >= 5) throw new Error(`Key derivation failed for role ${role}`);
    return deriveRoleKey(role, index + 1);
  };
  const derivedKeys = {
    [Roles.Zswap]: deriveRoleKey(Roles.Zswap),
    [Roles.NightExternal]: deriveRoleKey(Roles.NightExternal),
    [Roles.Dust]: deriveRoleKey(Roles.Dust),
  };

  hdWallet.hdWallet.clear();
  emit('debug', 'wallet', 'Keys derived, creating secret keys');

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(
    derivedKeys[Roles.Zswap],
  );
  const dustSecretKey = ledger.DustSecretKey.fromSeed(
    derivedKeys[Roles.Dust],
  );
  const unshieldedKeystore = createKeystore(
    derivedKeys[Roles.NightExternal],
    effectiveConfig.networkId,
  );

  const checkpoint = await loadCheckpoint(environment, accountIndex, walletId);
  const txHistoryStorage = checkpoint
    ? InMemoryTransactionHistoryStorage.fromSerialized(
        checkpoint.txHistoryState,
      )
    : new InMemoryTransactionHistoryStorage();

  const config = {
    networkId: effectiveConfig.networkId,
    indexerClientConnection: {
      indexerHttpUrl: effectiveConfig.indexerHttpUrl,
      indexerWsUrl: effectiveConfig.indexerWsUrl,
    },
    provingServerUrl: new URL(effectiveConfig.provingServerUrl),
    relayURL: new URL(effectiveConfig.nodeWsUrl),
    costParameters: { feeBlocksMargin: 5 },
    txHistoryStorage,
  };

  emit('info', 'wallet', 'Creating WalletFacade', {
    networkId: effectiveConfig.networkId,
    indexer: effectiveConfig.indexerHttpUrl,
    node: effectiveConfig.nodeWsUrl,
    prover: effectiveConfig.provingServerUrl,
    restoringFromCheckpoint: checkpoint !== null,
  });
  const facadeT0 = Date.now();
  let facade: WalletFacade;

  if (checkpoint) {
    try {
      emit('info', 'wallet', 'Restoring from checkpoint', {
        savedAt: new Date(checkpoint.savedAt).toISOString(),
        environment,
      });
      facade = await WalletFacade.init({
        configuration: config,
        shielded: (cfg) =>
          CustomShieldedWallet(cfg, makeShieldedBuilder(environment)).restore(checkpoint.shieldedState),
        unshielded: (cfg) =>
          UnshieldedWallet(cfg).restore(
            checkpoint.unshieldedState,
          ),
        dust: (cfg) =>
          CustomDustWallet(cfg, makeDustBuilder(environment)).restore(checkpoint.dustState),
        provingService: () =>
          makeServerProvingService({
            provingServerUrl: new URL(
              effectiveConfig.provingServerUrl,
            ),
          }),
      });
    } catch (restoreErr) {
      emit(
        'warn',
        'wallet',
        'Checkpoint restore failed, falling back to fresh sync',
        { error: String(restoreErr) },
      );
      await clearCheckpoint(environment, accountIndex, walletId);
      facade = await WalletFacade.init({
        configuration: config,
        shielded: (cfg) =>
          CustomShieldedWallet(cfg, makeShieldedBuilder(environment)).startWithSeed(
            derivedKeys[Roles.Zswap],
          ),
        unshielded: (cfg) =>
          UnshieldedWallet(cfg).startWithPublicKey(
            PublicKey.fromKeyStore(unshieldedKeystore),
          ),
        dust: (cfg) =>
          CustomDustWallet(cfg, makeDustBuilder(environment)).startWithSeed(
            derivedKeys[Roles.Dust],
            ledger.LedgerParameters.initialParameters().dust,
          ),
        provingService: () =>
          makeServerProvingService({
            provingServerUrl: new URL(
              effectiveConfig.provingServerUrl,
            ),
          }),
      });
    }
  } else {
    // Import bundled cache if IndexedDB is empty for this network
    const [shieldedCached, dustCached] = await Promise.all([
      getMaxEventId(environment, 'zswap'),
      getMaxEventId(environment, 'dust'),
    ]);
    if (shieldedCached === 0 && dustCached === 0) {
      await importBundledCache(environment);
    }

    facade = await WalletFacade.init({
      configuration: config,
      shielded: (cfg) =>
        CustomShieldedWallet(cfg, makeShieldedBuilder(environment)).startWithSeed(
          derivedKeys[Roles.Zswap],
        ),
      unshielded: (cfg) =>
        UnshieldedWallet(cfg).startWithPublicKey(
          PublicKey.fromKeyStore(unshieldedKeystore),
        ),
      dust: (cfg) =>
        CustomDustWallet(cfg, makeDustBuilder(environment)).startWithSeed(
          derivedKeys[Roles.Dust],
          ledger.LedgerParameters.initialParameters().dust,
        ),
      provingService: () =>
        makeServerProvingService({
          provingServerUrl: new URL(
            effectiveConfig.provingServerUrl,
          ),
        }),
    });
  }
  emit('info', 'wallet', 'WalletFacade.init complete', undefined, Date.now() - facadeT0);

  // --- Phase 1: Subscribe + set activeWallet (fast, unblocks UI) ---

  let lastStatus = '';
  let lastPhase = '';
  let lastProgressEmit = 0;
  let lastAppliedTotal = 0;
  let lastAdvanceTime = Date.now();
  let stallWarned = false;
  let wasSynced = false;
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

    if (serialized.status !== lastStatus) {
      emit('info', 'state', `Status: ${lastStatus || '(none)'} -> ${serialized.status}`, {
        shielded: serialized.shielded.progress,
        unshielded: serialized.unshielded.progress,
        dust: serialized.dust.progress,
        syncPercent: serialized.overallSyncPercent,
      });
      lastStatus = serialized.status;
    }

    if (serialized.syncPhase !== lastPhase) {
      emit('info', 'sync', `Phase: ${lastPhase || '(none)'} -> ${serialized.syncPhase}`, {
        shielded: serialized.shielded.syncPercent,
        unshielded: serialized.unshielded.syncPercent,
        dust: serialized.dust.syncPercent,
      });
      lastPhase = serialized.syncPhase;
    }

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

    if (!serialized.isSynced && (Date.now() - lastAdvanceTime) >= 30_000) {
      serialized.syncPhase = 'stalled';
    }

    // Checkpoint only on sync completion (not periodically — offscreen is persistent)
    if (facadeState.isSynced && !wasSynced) {
      wasSynced = true;
      saveCheckpoint(
        facade,
        txHistoryStorage,
        environment,
        accountIndex,
        walletId,
      ).catch((err) => {
        emit('warn', 'storage', 'Checkpoint failed', {
          error: String(err),
        });
      });
    }

    // State is broadcast to SW via stateListeners; SW caches in session storage
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
    txHistoryStorage,
    environment,
    accountIndex,
    walletName,
    walletId,
    subscription: sub,
    latestState: null,
    startPromise: null,
    stallCheckInterval,
  };

  emit('info', 'wallet', 'WalletFacade ready, starting sync in background', { environment, networkId: effectiveConfig.networkId }, Date.now() - t0);

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
    try {
      await saveCheckpoint(
        activeWallet.facade,
        activeWallet.txHistoryStorage,
        activeWallet.environment,
        activeWallet.accountIndex,
        activeWallet.walletId,
      );
    } catch (e) {
      emit('warn', 'storage', 'Final checkpoint save failed', {
        error: String(e),
      });
    }
    try {
      await activeWallet.facade.stop();
    } catch (e) {
      emit('warn', 'wallet', 'Facade stop error (ignored)', { error: String(e) });
    }
    activeWallet = null;
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
