import type {
  WalletFacade,
  UtxoWithMeta,
} from '@midnight-ntwrk/wallet-sdk-facade';
import type { UnshieldedKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import type { DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import type { TransactionResult } from '@shared/types';

export interface DustRegistrationParams {
  nightUtxos: UtxoWithMeta[];
  dustReceiverAddress?: DustAddress | undefined;
}

export async function executeDustRegistration(
  facade: WalletFacade,
  params: DustRegistrationParams,
  unshieldedKeystore: UnshieldedKeystore,
): Promise<TransactionResult> {
  try {
    if (params.nightUtxos.length === 0) {
      return {
        success: false,
        error: 'At least one Night UTXO is required for registration',
      };
    }

    const recipe = await facade.registerNightUtxosForDustGeneration(
      params.nightUtxos,
      unshieldedKeystore.getPublicKey(),
      (payload) => unshieldedKeystore.signData(payload),
      params.dustReceiverAddress,
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
          : 'Unknown error during dust registration',
    };
  }
}
