import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WalletStore, Environment } from '@shared/types';

const mockSessionStorage = {
  set: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockResolvedValue({}),
};
vi.stubGlobal('chrome', { storage: { session: mockSessionStorage } });

let mockStore: WalletStore | undefined;

vi.mock('@shared/storage', () => ({
  getWalletStore: vi.fn(async () => mockStore),
  saveWalletStore: vi.fn(async (store: WalletStore) => {
    mockStore = structuredClone(store);
  }),
}));

async function freshImport() {
  vi.resetModules();
  return await import('./stateManager');
}

describe('stateManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore = undefined;
    mockSessionStorage.set.mockResolvedValue(undefined);
    mockSessionStorage.remove.mockResolvedValue(undefined);
  });

  describe('addWallet', () => {
    it('appends wallet to store and sets activeWalletIndex', async () => {
      const mod = await freshImport();
      const seed = new Uint8Array([1, 2, 3]);
      await mod.addWallet('Testnet', seed, 'dev');

      expect(mockStore).toBeDefined();
      expect(mockStore!.wallets).toHaveLength(1);
      expect(mockStore!.wallets[0]!.name).toBe('Testnet 0');
      expect(mockStore!.activeWalletIndex).toBe(0);
      expect(mockStore!.activeEnvironment).toBe('dev');
    });

    it('updates activeSeed so isUnlocked returns true', async () => {
      const mod = await freshImport();
      expect(mod.isUnlocked()).toBe(false);

      await mod.addWallet('Test', new Uint8Array([10]), 'dev');
      expect(mod.isUnlocked()).toBe(true);
      expect(mod.getSeed()).toEqual(new Uint8Array([10]));
    });

    it('sets session storage markers', async () => {
      const mod = await freshImport();
      await mod.addWallet('Test', new Uint8Array([1]), 'preview');

      expect(mockSessionStorage.set).toHaveBeenCalledWith(
        expect.objectContaining({
          gsdSessionActive: true,
          gsdEnvironment: 'preview',
          gsdActiveWalletIdx: 0,
        }),
      );
    });

    it('appends second wallet with incremented name', async () => {
      const mod = await freshImport();
      await mod.addWallet('Net', new Uint8Array([1]), 'dev');
      await mod.addWallet('Net', new Uint8Array([2]), 'dev');

      expect(mockStore!.wallets).toHaveLength(2);
      expect(mockStore!.wallets[0]!.name).toBe('Net 0');
      expect(mockStore!.wallets[1]!.name).toBe('Net 1');
      expect(mockStore!.activeWalletIndex).toBe(1);
    });
  });

  describe('switchWallet', () => {
    it('returns seed for valid index', async () => {
      const mod = await freshImport();
      await mod.addWallet('A', new Uint8Array([1, 2]), 'dev');
      await mod.addWallet('B', new Uint8Array([3, 4]), 'dev');

      const seed = await mod.switchWallet(0);
      expect(seed).toEqual(new Uint8Array([1, 2]));
      expect(mod.getSeed()).toEqual(new Uint8Array([1, 2]));
    });

    it('throws for invalid index', async () => {
      const mod = await freshImport();
      await mod.addWallet('A', new Uint8Array([1]), 'dev');

      await expect(mod.switchWallet(99)).rejects.toThrow(
        'Wallet 99 not found',
      );
    });
  });

  describe('deleteWallet', () => {
    it('removes wallet and rebalances index', async () => {
      const mod = await freshImport();
      await mod.addWallet('A', new Uint8Array([1]), 'dev');
      await mod.addWallet('B', new Uint8Array([2]), 'dev');
      // active is now index 1
      await mod.deleteWallet(0);

      expect(mockStore!.wallets).toHaveLength(1);
      expect(mockStore!.activeWalletIndex).toBe(0);
      expect(mod.getSeed()).toEqual(new Uint8Array([2]));
    });

    it('resets to empty state when last wallet deleted', async () => {
      const mod = await freshImport();
      await mod.addWallet('A', new Uint8Array([1]), 'dev');
      await mod.deleteWallet(0);

      expect(mockStore!.wallets).toHaveLength(0);
      expect(mockStore!.activeWalletIndex).toBe(0);
      expect(mockStore!.activeEnvironment).toBe('undeployed');
      expect(mod.getSeed()).toBeNull();
      expect(mod.isUnlocked()).toBe(false);
    });
  });

  describe('withStoreLock serialization', () => {
    it('two concurrent addWallet calls execute sequentially', async () => {
      const mod = await freshImport();

      const p1 = mod.addWallet('X', new Uint8Array([1]), 'dev');
      const p2 = mod.addWallet('Y', new Uint8Array([2]), 'dev');
      await Promise.all([p1, p2]);

      expect(mockStore!.wallets).toHaveLength(2);
      expect(mockStore!.wallets[0]!.name).toBe('X 0');
      expect(mockStore!.wallets[1]!.name).toBe('Y 1');
    });
  });

  describe('lock', () => {
    it('zeros and nulls activeSeed', async () => {
      const mod = await freshImport();
      await mod.addWallet('A', new Uint8Array([9, 8, 7]), 'dev');
      const seedRef = mod.getSeed()!;

      mod.lock();

      expect(mod.getSeed()).toBeNull();
      expect(mod.isUnlocked()).toBe(false);
      // Original buffer zeroed
      expect(seedRef.every((b) => b === 0)).toBe(true);
    });

    it('removes session storage key', async () => {
      const mod = await freshImport();
      await mod.addWallet('A', new Uint8Array([1]), 'dev');
      mod.lock();

      expect(mockSessionStorage.remove).toHaveBeenCalledWith([
        'gsdSessionActive',
      ]);
    });
  });

  describe('autoUnlock', () => {
    it('returns true and sets activeSeed with existing wallets', async () => {
      const mod = await freshImport();
      await mod.addWallet('A', new Uint8Array([5, 6]), 'dev');
      mod.lock();
      expect(mod.isUnlocked()).toBe(false);

      const result = await mod.autoUnlock();
      expect(result).toBe(true);
      expect(mod.isUnlocked()).toBe(true);
      expect(mod.getSeed()).toEqual(new Uint8Array([5, 6]));
    });

    it('returns false with empty store', async () => {
      const mod = await freshImport();
      const result = await mod.autoUnlock();
      expect(result).toBe(false);
      expect(mod.isUnlocked()).toBe(false);
    });
  });

  describe('isUnlocked / getSeed', () => {
    it('initially unlocked=false and seed=null', async () => {
      const mod = await freshImport();
      expect(mod.isUnlocked()).toBe(false);
      expect(mod.getSeed()).toBeNull();
    });
  });
});
