import { openDB, type IDBPDatabase } from 'idb';
import type {
  VaultData,
  PermissionRecord,
  TxHistoryEntry,
  WalletStore,
} from './types';

const DB_NAME = 'gsd-wallet';
const DB_VERSION = 1;

type GsdDB = IDBPDatabase;

let dbPromise: Promise<GsdDB> | undefined;

function getDb(): Promise<GsdDB> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('vault')) {
          db.createObjectStore('vault');
        }
        if (!db.objectStoreNames.contains('permissions')) {
          db.createObjectStore('permissions', { keyPath: 'origin' });
        }
        if (!db.objectStoreNames.contains('txHistory')) {
          const store = db.createObjectStore('txHistory', {
            keyPath: 'txHash',
          });
          store.createIndex('byAccount', 'accountIndex');
          store.createIndex('byTimestamp', 'timestamp');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
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
