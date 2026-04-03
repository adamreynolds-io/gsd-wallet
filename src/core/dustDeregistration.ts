import type {
  WalletFacade,
  UtxoWithMeta,
} from '@midnight-ntwrk/wallet-sdk-facade';
import type { UnshieldedKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import type * as ledger from '@midnight-ntwrk/ledger-v8';
import type { TransactionResult } from '@shared/types';

export interface DustDeregistrationParams {
  nightUtxos: UtxoWithMeta[];
}

export interface DeregistrationSecretKeys {
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
}

export async function executeDustDeregistration(
  facade: WalletFacade,
  params: DustDeregistrationParams,
  unshieldedKeystore: UnshieldedKeystore,
  secretKeys: DeregistrationSecretKeys,
): Promise<TransactionResult> {
  try {
    if (params.nightUtxos.length === 0) {
      return {
        success: false,
        error:
          'At least one Night UTXO is required for deregistration',
      };
    }

    const deregRecipe = await facade.deregisterFromDustGeneration(
      params.nightUtxos,
      unshieldedKeystore.getPublicKey(),
      (payload) => unshieldedKeystore.signData(payload),
    );

    // Deregistration requires dust fee balancing (SDK: deregistration.ts)
    const balancedRecipe = await facade.balanceUnprovenTransaction(
      deregRecipe.transaction,
      secretKeys,
      {
        ttl: new Date(Date.now() + 30 * 60 * 1000),
        tokenKindsToBalance: ['dust'],
      },
    );

    const provenTx = await facade.finalizeRecipe(balancedRecipe);
    const txId = await facade.submitTransaction(provenTx);

    return { success: true, txId };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : 'Unknown error during dust deregistration',
    };
  }
}
