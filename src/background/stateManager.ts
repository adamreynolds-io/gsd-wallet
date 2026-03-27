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
  const store = await getWalletStore();
  return store ?? { wallets: [], activeEnvironment: 'dev', activeWalletIndex: 0 };
}

export async function addWallet(
  name: string,
  seed: Uint8Array,
  environment: Environment,
): Promise<void> {
  const store = await getStore();
  store.wallets.push({
    name,
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
  activeSeed = null;
  chrome.storage.session.remove(['gsdSessionActive']);
}

export async function clearAll(): Promise<void> {
  lock();
  await saveWalletStore({ wallets: [], activeEnvironment: 'dev', activeWalletIndex: 0 });
}

export async function getActiveWalletInfo(): Promise<{ environment: Environment; walletIndex: number; name: string } | null> {
  const store = await getStore();
  const wallet = store.wallets[store.activeWalletIndex];
  if (!wallet) return null;
  return { environment: wallet.environment, walletIndex: store.activeWalletIndex, name: wallet.name };
}
