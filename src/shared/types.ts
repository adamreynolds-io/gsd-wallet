import type { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';

export type Environment =
  | 'mainnet'
  | 'mainnet-vpn'
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
  connections: {
    node: boolean;
    indexer: boolean;
    prover: boolean;
  };
  activeWalletName: string;
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
