import type {
  WalletFacade,
  UtxoWithMeta,
} from '@midnight-ntwrk/wallet-sdk-facade';
import type { UnshieldedKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import type { TransactionResult } from '@shared/types';

export interface DustDeregistrationParams {
  nightUtxos: UtxoWithMeta[];
}

export async function executeDustDeregistration(
  facade: WalletFacade,
  params: DustDeregistrationParams,
  unshieldedKeystore: UnshieldedKeystore,
): Promise<TransactionResult> {
  try {
    if (params.nightUtxos.length === 0) {
      return {
        success: false,
        error:
          'At least one Night UTXO is required for deregistration',
      };
    }

    const recipe = await facade.deregisterFromDustGeneration(
      params.nightUtxos,
      unshieldedKeystore.getPublicKey(),
      (payload) => unshieldedKeystore.signData(payload),
    );

    const provenTx = await facade.finalizeRecipe(recipe);
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
