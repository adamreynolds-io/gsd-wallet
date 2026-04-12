import { openDB, type IDBPDatabase } from 'idb';
import type {
  VaultData,
  PermissionRecord,
  TxHistoryEntry,
  WalletStore,
  PersistedSdkState,
  Environment,
  NetworkEventType,
  CachedNetworkEvent,
} from './types';

const DB_NAME = 'gsd-wallet';
const DB_VERSION = 4;

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
        if (oldVersion < 3) {
          const store = db.createObjectStore('networkEvents', { keyPath: 'key' });
          store.createIndex('byNetworkAndType', ['network', 'type']);
        }
        if (oldVersion < 4) {
          db.createObjectStore('provingKeys', { keyPath: 'location' });
          db.createObjectStore('provingParams', { keyPath: 'k' });
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
  walletId: string,
): string {
  return `${environment}:${accountIndex}:${walletId}`;
}

export async function getSdkState(
  environment: Environment,
  accountIndex: number,
  walletId: string,
): Promise<PersistedSdkState | undefined> {
  const db = await getDb();
  return db.get('sdkState', sdkStateKey(environment, accountIndex, walletId)) as
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
  walletId: string,
): Promise<void> {
  const db = await getDb();
  await db.delete('sdkState', sdkStateKey(environment, accountIndex, walletId));
}

export async function deleteAllSdkState(): Promise<void> {
  const db = await getDb();
  await db.clear('sdkState');
}

// --- Network Event Cache ---

function networkEventKey(
  network: string,
  type: NetworkEventType,
  id: number,
): string {
  return `${network}:${type}:${id}`;
}

export async function getNetworkEvents(
  network: string,
  type: NetworkEventType,
  fromId: number = 0,
): Promise<CachedNetworkEvent[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex(
    'networkEvents',
    'byNetworkAndType',
    [network, type],
  );
  return (all as CachedNetworkEvent[])
    .filter((e) => e.id > fromId)
    .sort((a, b) => a.id - b.id);
}

export async function getNetworkEventsInRange(
  network: string,
  type: NetworkEventType,
  fromId: number,
  toId: number,
): Promise<CachedNetworkEvent[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex(
    'networkEvents',
    'byNetworkAndType',
    [network, type],
  );
  return (all as CachedNetworkEvent[])
    .filter((e) => e.id > fromId && e.id <= toId)
    .sort((a, b) => a.id - b.id);
}

export async function putNetworkEvents(
  network: string,
  type: NetworkEventType,
  events: Array<{ id: number; raw: string; maxId: number }>,
): Promise<void> {
  if (events.length === 0) return;
  const db = await getDb();
  const tx = db.transaction('networkEvents', 'readwrite');
  const store = tx.objectStore('networkEvents');
  for (const event of events) {
    await store.put({
      key: networkEventKey(network, type, event.id),
      network,
      type,
      id: event.id,
      raw: event.raw,
      maxId: event.maxId,
    } satisfies CachedNetworkEvent);
  }
  await tx.done;
}

export async function getMaxEventId(
  network: string,
  type: NetworkEventType,
): Promise<number> {
  const db = await getDb();
  const all = await db.getAllFromIndex(
    'networkEvents',
    'byNetworkAndType',
    [network, type],
  );
  if (all.length === 0) return 0;
  return Math.max(...(all as CachedNetworkEvent[]).map((e) => e.id));
}

export async function clearNetworkEvents(
  network: string,
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('networkEvents', 'readwrite');
  const store = tx.objectStore('networkEvents');
  const index = store.index('byNetworkAndType');
  // Clear both zswap and dust events for this network
  for (const type of ['zswap', 'dust'] as const) {
    let cursor = await index.openCursor([network, type]);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
  }
  await tx.done;
}

// --- Proving Key Cache ---

export interface ProvingKeyEntry {
  location: string;
  proverKey: Uint8Array;
  verifierKey: Uint8Array;
  ir: Uint8Array;
}

export async function getProvingKey(location: string): Promise<ProvingKeyEntry | undefined> {
  const db = await getDb();
  return db.get('provingKeys', location) as Promise<ProvingKeyEntry | undefined>;
}

export async function saveProvingKey(entry: ProvingKeyEntry): Promise<void> {
  const db = await getDb();
  await db.put('provingKeys', entry);
}

// --- Proving Params Cache ---

export interface ProvingParamsEntry {
  k: number;
  data: Uint8Array;
}

export async function getProvingParams(k: number): Promise<ProvingParamsEntry | undefined> {
  const db = await getDb();
  return db.get('provingParams', k) as Promise<ProvingParamsEntry | undefined>;
}

export async function saveProvingParams(entry: ProvingParamsEntry): Promise<void> {
  const db = await getDb();
  await db.put('provingParams', entry);
}
