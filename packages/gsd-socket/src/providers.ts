import type { GsdWalletConnect } from './client.js';

/**
 * Structural WalletProvider — satisfies @midnight-ntwrk/midnight-js-types WalletProvider.
 * balanceTx accepts an UnboundTransaction and returns a FinalizedTransaction.
 * Since we go through the socket wire protocol (hex serialization), we accept
 * objects with a serialize() method and return objects with a static deserialize.
 */
export interface GsdWalletProvider {
  balanceTx(
    tx: { serialize(): Uint8Array },
    ttl?: Date,
  ): Promise<{ serialize(): Uint8Array }>;
  getCoinPublicKey(): Promise<string>;
  getEncryptionPublicKey(): Promise<string>;
}

export interface GsdMidnightProvider {
  submitTx(
    tx: { serialize(): Uint8Array },
  ): Promise<string>;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function createWalletProvider(
  client: GsdWalletConnect,
): GsdWalletProvider {
  let cachedCoinPk: string | null = null;
  let cachedEncPk: string | null = null;

  return {
    async balanceTx(tx, _ttl) {
      const txHex = bytesToHex(tx.serialize());
      const { tx: resultHex } =
        await client.balanceUnsealedTransaction(txHex);
      const resultBytes = hexToBytes(resultHex);
      return {
        serialize: () => resultBytes,
      };
    },
    async getCoinPublicKey() {
      if (!cachedCoinPk) {
        const addrs = await client.getShieldedAddresses();
        cachedCoinPk = addrs.shieldedCoinPublicKey;
        cachedEncPk = addrs.shieldedEncryptionPublicKey;
      }
      return cachedCoinPk;
    },
    async getEncryptionPublicKey() {
      if (!cachedEncPk) {
        const addrs = await client.getShieldedAddresses();
        cachedCoinPk = addrs.shieldedCoinPublicKey;
        cachedEncPk = addrs.shieldedEncryptionPublicKey;
      }
      return cachedEncPk;
    },
  };
}

export function createMidnightProvider(
  client: GsdWalletConnect,
): GsdMidnightProvider {
  return {
    async submitTx(tx) {
      const txHex = bytesToHex(tx.serialize());
      const txId = await client.submitTransaction(txHex);
      return txId;
    },
  };
}

export function createProviders(client: GsdWalletConnect): {
  walletProvider: GsdWalletProvider;
  midnightProvider: GsdMidnightProvider;
} {
  return {
    walletProvider: createWalletProvider(client),
    midnightProvider: createMidnightProvider(client),
  };
}
