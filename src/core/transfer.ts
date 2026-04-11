import type {
  WalletFacade,
  BalancingRecipe,
  CombinedTokenTransfer,
} from '@midnight-ntwrk/wallet-sdk-facade';
import type { UnshieldedKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import type * as ledger from '@midnight-ntwrk/ledger-v8';
import {
  MidnightBech32m,
  ShieldedAddress,
  UnshieldedAddress,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import type { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import type { TransactionResult } from '@shared/types';
import { validateAddress } from '@core/addressValidation';
import { TX_TTL_MS } from '@shared/constants';

export interface TransferParams {
  tokenType: 'shielded' | 'unshielded';
  tokenId: string;
  amount: bigint;
  receiverAddress: string;
}

export interface TransferSecretKeys {
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
}

export async function executeTransfer(
  facade: WalletFacade,
  params: TransferParams,
  secretKeys: TransferSecretKeys,
  networkId: NetworkId.NetworkId,
  unshieldedKeystore?: UnshieldedKeystore,
): Promise<TransactionResult> {
  try {
    const addrResult = validateAddress(params.receiverAddress, params.tokenType, networkId);
    if (!addrResult.valid) {
      return { success: false, error: addrResult.error };
    }

    const ttl = new Date(Date.now() + TX_TTL_MS);

    const parsedAddress = MidnightBech32m.parse(params.receiverAddress);
    const transfer: CombinedTokenTransfer =
      params.tokenType === 'shielded'
        ? {
            type: 'shielded',
            outputs: [
              {
                type: params.tokenId,
                receiverAddress: ShieldedAddress.codec.decode(
                  networkId,
                  parsedAddress,
                ),
                amount: params.amount,
              },
            ],
          }
        : {
            type: 'unshielded',
            outputs: [
              {
                type: params.tokenId,
                receiverAddress: UnshieldedAddress.codec.decode(
                  networkId,
                  parsedAddress,
                ),
                amount: params.amount,
              },
            ],
          };

    const recipe = await facade.transferTransaction(
      [transfer],
      secretKeys,
      { ttl },
    );

    let signedRecipe: BalancingRecipe = recipe;
    if (params.tokenType === 'unshielded' && !unshieldedKeystore) {
      return { success: false, error: 'Unshielded keystore required for unshielded transfer' };
    }
    if (unshieldedKeystore) {
      signedRecipe = await facade.signRecipe(recipe, (payload) =>
        unshieldedKeystore.signData(payload),
      );
    }

    const finalizedTx = await facade.finalizeRecipe(signedRecipe);
    const txId = await facade.submitTransaction(finalizedTx);

    return { success: true, txId };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : 'Unknown error during transfer',
    };
  }
}
