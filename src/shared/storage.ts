import { openDB, type IDBPDatabase } from 'idb';
import type {
  VaultData,
  PermissionRecord,
  TxHistoryEntry,
  WalletStore,
  PersistedSdkState,
  Environment,
} from './types';

const DB_NAME = 'gsd-wallet';
const DB_VERSION = 2;

type GsdDB = IDBPDatabase;

let dbPromise: Promise<GsdDB> | undefined;

function getDb(): Promise<GsdDB> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('vault');
          db.createObjectStore('permissions', { keyPath: 'origin' });
          const txStore = db.createObjectStore('txHistory', {
            keyPath: 'txHash',
          });
          txStore.createIndex('byAccount', 'accountIndex');
          txStore.createIndex('byTimestamp', 'timestamp');
          db.createObjectStore('settings');
        }
        if (oldVersion < 2) {
          db.createObjectStore('sdkState', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

// --- Vault ---

export async function getVault(): Promise<VaultData | undefined> {
  const db = await getDb();
  return db.get('vault', 'master') as Promise<VaultData | undefined>;
}

export async function saveVault(vault: VaultData): Promise<void> {
  const db = await getDb();
  await db.put('vault', vault, 'master');
}

export async function deleteVault(): Promise<void> {
  const db = await getDb();
  await db.delete('vault', 'master');
}

export async function hasVault(): Promise<boolean> {
  const vault = await getVault();
  return vault !== undefined;
}

// --- Permissions ---

export async function getPermission(
  origin: string,
): Promise<PermissionRecord | undefined> {
  const db = await getDb();
  return db.get('permissions', origin) as Promise<
    PermissionRecord | undefined
  >;
}

export async function savePermission(
  record: PermissionRecord,
): Promise<void> {
  const db = await getDb();
  await db.put('permissions', record);
}

export async function deletePermission(origin: string): Promise<void> {
  const db = await getDb();
  await db.delete('permissions', origin);
}

export async function getAllPermissions(): Promise<PermissionRecord[]> {
  const db = await getDb();
  return db.getAll('permissions') as Promise<PermissionRecord[]>;
}

// --- Transaction History ---

export async function addTxHistoryEntry(
  entry: TxHistoryEntry,
): Promise<void> {
  const db = await getDb();
  await db.put('txHistory', entry);
}

export async function getTxHistory(
  accountIndex: number,
  page: number,
  pageSize: number,
): Promise<TxHistoryEntry[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex(
    'txHistory',
    'byAccount',
    accountIndex,
  );
  const sorted = (all as TxHistoryEntry[]).sort(
    (a, b) => b.timestamp - a.timestamp,
  );
  const start = page * pageSize;
  return sorted.slice(start, start + pageSize);
}

// --- Wallet Store (per-environment wallets) ---

export async function getWalletStore(): Promise<WalletStore | undefined> {
  const db = await getDb();
  return db.get('settings', 'walletStore') as Promise<WalletStore | undefined>;
}

export async function saveWalletStore(store: WalletStore): Promise<void> {
  const db = await getDb();
  await db.put('settings', store, 'walletStore');
}

// --- Settings ---

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const db = await getDb();
  return db.get('settings', key) as Promise<T | undefined>;
}

export async function saveSetting<T>(
  key: string,
  value: T,
): Promise<void> {
  const db = await getDb();
  await db.put('settings', value, key);
}

// --- SDK State (checkpoint persistence) ---

function sdkStateKey(
  environment: Environment,
  accountIndex: number,
): string {
  return `${environment}:${accountIndex}`;
}

export async function getSdkState(
  environment: Environment,
  accountIndex: number,
): Promise<PersistedSdkState | undefined> {
  const db = await getDb();
  return db.get('sdkState', sdkStateKey(environment, accountIndex)) as
    Promise<PersistedSdkState | undefined>;
}

export async function saveSdkState(
  state: PersistedSdkState,
): Promise<void> {
  const db = await getDb();
  await db.put('sdkState', state);
}

export async function deleteSdkState(
  environment: Environment,
  accountIndex: number,
): Promise<void> {
  const db = await getDb();
  await db.delete('sdkState', sdkStateKey(environment, accountIndex));
}

export async function deleteAllSdkState(): Promise<void> {
  const db = await getDb();
  await db.clear('sdkState');
}
