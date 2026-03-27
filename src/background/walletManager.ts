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
}

let activeWallet: ActiveWallet | null = null;
let stateListeners: Array<(state: SerializedWalletState) => void> = [];

export function getActiveWallet(): ActiveWallet | null {
  return activeWallet;
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
  const overallSyncPercent = Math.floor(
    (shieldedPercent + unshieldedPercent + dustPercent) / 3,
  );
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
        connected: dp.isConnected,
      },
    },
    overallSyncPercent,
    isSynced: reallySynced,
    connections: {
      node: up.isConnected,
      indexer: sp.isConnected,
      prover: true, // TODO: track real prover connectivity
    },
    activeWalletName: activeWallet?.walletName ?? '',
  };
}

export async function initializeWallet(
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
  await stopWallet();

  const envConfig = getEnvironmentConfig(environment);
  const effectiveConfig = customUrls
    ? { ...envConfig, ...customUrls }
    : envConfig;

  const hdWallet = HDWallet.fromSeed(seed);
  if (hdWallet.type !== 'seedOk') {
    throw new Error('Failed to initialize HDWallet from seed');
  }

  const derivationResult = hdWallet.hdWallet
    .selectAccount(accountIndex)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);

  if (derivationResult.type !== 'keysDerived') {
    throw new Error('Failed to derive keys from HD wallet');
  }

  hdWallet.hdWallet.clear();

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

  await facade.start(shieldedSecretKeys, dustSecretKey);

  const sub = facade.state().subscribe((facadeState) => {
    if (activeWallet) {
      activeWallet.latestState = facadeState;
    }
    const serialized = serializeState(
      facadeState,
      environment,
      accountIndex,
    );
    chrome.storage.session.set({ gsdLastState: serialized });
    for (const listener of stateListeners) {
      listener(serialized);
    }
  });

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
  };

  chrome.alarms.create('gsd-keepalive', { periodInMinutes: 0.4 });
}

export async function stopWallet(): Promise<void> {
  if (activeWallet) {
    console.log('[GSD] Stopping wallet...');
    activeWallet.subscription.unsubscribe();
    try {
      await activeWallet.facade.stop();
    } catch (e) {
      console.warn('[GSD] Facade stop error (ignored):', e);
    }
    activeWallet = null;
    chrome.alarms.clear('gsd-keepalive');
    console.log('[GSD] Wallet stopped');
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
