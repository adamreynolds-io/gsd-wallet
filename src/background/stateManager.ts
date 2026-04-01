import {
  getWalletStore,
  saveWalletStore,
} from '@shared/storage';
import type { Environment, WalletStore, WalletEntry } from '@shared/types';

let activeSeed: Uint8Array | null = null;

export function isUnlocked(): boolean {
  return activeSeed !== null;
}

export function getSeed(): Uint8Array | null {
  return activeSeed;
}

export async function walletStoreExists(): Promise<boolean> {
  const store = await getWalletStore();
  return store !== undefined && store.wallets.length > 0;
}

export async function getStore(): Promise<WalletStore> {
  return await getWalletStore() ?? { wallets: [], activeEnvironment: 'undeployed' as Environment, activeWalletIndex: 0 };
}

export async function addWallet(
  name: string,
  seed: Uint8Array,
  environment: Environment,
): Promise<void> {
  const store = await getStore();
  // Append index if the name doesn't already include one (e.g. "Mainnet" → "Mainnet 0")
  const isGenesis = /^Genesis W[0-3]$/.test(name);
  let walletName = name;
  if (!isGenesis) {
    const existingCount = store.wallets.filter((w) => w.environment === environment).length;
    walletName = `${name} ${existingCount}`;
  }
  store.wallets.push({
    name: walletName,
    seed: Array.from(seed),
    environment,
  });
  store.activeEnvironment = environment;
  store.activeWalletIndex = store.wallets.length - 1;
  await saveWalletStore(store);

  activeSeed = seed;

  await chrome.storage.session.set({
    gsdSessionActive: true,
    gsdEnvironment: environment,
    gsdActiveWalletIdx: store.activeWalletIndex,
  });
}

export async function switchWallet(index: number): Promise<Uint8Array> {
  const store = await getStore();
  const wallet = store.wallets[index];
  if (!wallet) throw new Error(`Wallet ${index} not found`);

  store.activeWalletIndex = index;
  store.activeEnvironment = wallet.environment;
  await saveWalletStore(store);

  activeSeed = new Uint8Array(wallet.seed);

  await chrome.storage.session.set({
    gsdSessionActive: true,
    gsdEnvironment: wallet.environment,
    gsdActiveWalletIdx: index,
  });

  return activeSeed;
}

export async function switchEnvironment(environment: Environment): Promise<Uint8Array | null> {
  const store = await getStore();
  // Find the first wallet for this environment
  const idx = store.wallets.findIndex((w) => w.environment === environment);
  if (idx === -1) return null;

  return switchWallet(idx);
}

export async function getWalletsForEnvironment(environment: Environment): Promise<Array<{ index: number; name: string }>> {
  const store = await getStore();
  return store.wallets
    .map((w, i) => ({ index: i, name: w.name, environment: w.environment }))
    .filter((w) => w.environment === environment);
}

export async function autoUnlock(): Promise<boolean> {
  const store = await getStore();
  if (store.wallets.length === 0) return false;

  const wallet = store.wallets[store.activeWalletIndex];
  if (!wallet) return false;

  activeSeed = new Uint8Array(wallet.seed);
  await chrome.storage.session.set({ gsdSessionActive: true });
  return true;
}

export function lock(): void {
  if (activeSeed) activeSeed.fill(0);
  activeSeed = null;
  chrome.storage.session.remove(['gsdSessionActive']);
}

export async function clearAll(): Promise<void> {
  lock();
  await saveWalletStore({ wallets: [], activeEnvironment: 'undeployed', activeWalletIndex: 0 });
}

export async function deleteWallet(index: number): Promise<void> {
  const store = await getStore();
  if (!store.wallets[index]) throw new Error(`Wallet ${index} not found`);
  store.wallets.splice(index, 1);
  if (store.wallets.length === 0) {
    store.activeWalletIndex = 0;
    store.activeEnvironment = 'undeployed';
  } else if (index <= store.activeWalletIndex) {
    store.activeWalletIndex = Math.max(0, store.activeWalletIndex - 1);
    const w = store.wallets[store.activeWalletIndex];
    if (w) store.activeEnvironment = w.environment;
  }
  await saveWalletStore(store);
}

export async function getAllWalletsGrouped(): Promise<{
  wallets: Record<Environment, Array<{ index: number; name: string }>>;
  activeWalletIndex: number;
  activeEnvironment: Environment;
}> {
  const store = await getStore();
  const grouped: Record<string, Array<{ index: number; name: string }>> = {
    mainnet: [], preprod: [], preview: [], qanet: [], dev: [], undeployed: [],
  };
  store.wallets.forEach((w, i) => {
    grouped[w.environment]?.push({ index: i, name: w.name });
  });
  return {
    wallets: grouped as Record<Environment, Array<{ index: number; name: string }>>,
    activeWalletIndex: store.activeWalletIndex,
    activeEnvironment: store.activeEnvironment,
  };
}

export async function getActiveWalletInfo(): Promise<{ environment: Environment; walletIndex: number; name: string } | null> {
  const store = await getStore();
  const wallet = store.wallets[store.activeWalletIndex];
  if (!wallet) return null;
  return { environment: wallet.environment, walletIndex: store.activeWalletIndex, name: wallet.name };
}
