import type { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';

export type Environment =
  | 'mainnet'
  | 'preprod'
  | 'preview'
  | 'qanet'
  | 'dev'
  | 'undeployed';

export type SeedType = 'mnemonic' | 'hex' | 'randomHex';

export interface EnvironmentConfig {
  networkId: NetworkId.NetworkId;
  indexerHttpUrl: string;
  indexerWsUrl: string;
  nodeWsUrl: string;
  provingServerUrl: string;
}

export type TransactionResult =
  | { success: true; txId: string }
  | { success: false; error: string };

export type WalletStatus =
  | 'locked'
  | 'unlocked'
  | 'uninitialized'
  | 'initializing'
  | 'syncing'
  | 'synced'
  | 'error';

export interface AccountMeta {
  index: number;
  name: string;
  createdAt: number;
}

export interface VaultData {
  encryptedSeed: ArrayBuffer;
  iv: Uint8Array;
  salt: Uint8Array;
  iterations: number;
  accounts: AccountMeta[];
  version: 1;
  unprotected: boolean;
}

export interface WalletEntry {
  name: string;
  seed: number[];
  environment: Environment;
}

export interface WalletStore {
  wallets: WalletEntry[];
  activeEnvironment: Environment;
  activeWalletIndex: number;
}

export interface SerializedUtxo {
  id: string;
  value: string;
  tokenType: string;
  registered: boolean;
}

export interface SyncProgress {
  applied: number;
  highest: number;
  highestIndex: number;
  connected: boolean;
}

export interface SerializedWalletState {
  status: WalletStatus;
  environment: Environment;
  activeAccountIndex: number;
  shielded: {
    address: string;
    balances: Record<string, string>;
    coinCount: number;
    syncPercent: number;
    progress: SyncProgress;
  };
  unshielded: {
    address: string;
    balances: Record<string, string>;
    utxos: SerializedUtxo[];
    syncPercent: number;
    progress: SyncProgress;
  };
  dust: {
    address: string;
    balance: string;
    syncPercent: number;
    progress: SyncProgress;
  };
  overallSyncPercent: number;
  isSynced: boolean;
  syncPhase: 'connecting' | 'catching-up' | 'nearly-synced' | 'synced' | 'stalled';
  connections: {
    node: boolean;
    indexer: boolean;
    prover: boolean;
  };
  activeWalletName: string;
}

export interface PersistedSdkState {
  key: string;
  environment: Environment;
  accountIndex: number;
  shieldedState: string;
  unshieldedState: string;
  dustState: string;
  txHistoryState: string;
  savedAt: number;
  sdkVersion: string;
}

export interface PermissionRecord {
  origin: string;
  networkId: string;
  grantedMethods: string[];
  deniedMethods: string[];
  connectedAt: number;
  lastActivity: number;
}

export type TxStatus =
  | 'pending'
  | 'confirmed'
  | 'finalized'
  | 'discarded';

export interface TxHistoryEntry {
  txHash: string;
  status: TxStatus;
  timestamp: number;
  accountIndex: number;
  type: 'transfer' | 'dustReg' | 'dustDereg' | 'dappTx';
  metadata: Record<string, unknown>;
}

export type InspectorTarget =
  | { kind: 'transaction'; hash: string }
  | { kind: 'block'; height: number }
  | { kind: 'contract'; address: string };

// --- Socket ---

export type SocketState = 'off' | 'waiting' | 'active';

// --- Diagnostics ---

export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';

export type DiagnosticCategory =
  | 'sw'
  | 'wallet'
  | 'state'
  | 'sync'
  | 'sdk'
  | 'dapp'
  | 'api'
  | 'popup'
  | 'tx'
  | 'indexer'
  | 'storage'
  | 'error'
  | 'connect'
  | 'proving';

export const DIAGNOSTIC_LEVELS: readonly DiagnosticLevel[] = ['debug', 'info', 'warn', 'error'];

export const DIAGNOSTIC_CATEGORIES: readonly DiagnosticCategory[] = [
  'sw', 'wallet', 'state', 'sync', 'sdk', 'dapp', 'api', 'popup', 'tx', 'indexer', 'storage', 'error', 'connect', 'proving',
];

export interface DiagnosticEvent {
  id: number;
  timestamp: number;
  level: DiagnosticLevel;
  category: DiagnosticCategory;
  message: string;
  data?: unknown;
  elapsed?: number;
}

// --- Proving ---

export type ProvingMode = 'wasm' | 'server';

/**
 * kThreshold controls which proofs go to WASM vs server:
 * - Infinity: all proofs via WASM (no server needed)
 * - 17: WASM for k<=17, server for k>=18
 * - 15: WASM for k<=15, server for k>=16
 * - 0: all proofs via server (WASM disabled)
 */
export interface ProvingStrategy {
  kThreshold: number;
}

export interface ProvingStatus {
  phase: 'idle' | 'loading-keys' | 'proving' | 'submitting' | 'done' | 'cancelled' | 'error';
  activeProver: ProvingMode | null;
  kValue?: number;
  elapsed?: number;
  estimatedMs?: number;
  method?: string;
  error?: string;
}

export interface DeviceBenchmark {
  k10TimeMs: number;
  timestamp: number;
  estimates: Record<number, number>;
}

export const DEFAULT_PROVING_STRATEGY: ProvingStrategy = { kThreshold: 17 };

// --- Network Event Cache ---

export type NetworkEventType = 'zswap' | 'dust';

export interface CachedNetworkEvent {
  key: string; // `${network}:${type}:${id}`
  network: string;
  type: NetworkEventType;
  id: number;
  raw: string; // hex-encoded event data
  maxId: number;
}
