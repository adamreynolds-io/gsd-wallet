import type { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import type { InMemoryTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import type { Environment, PersistedSdkState } from '@shared/types';
import {
  getSdkState,
  saveSdkState,
  deleteSdkState,
  deleteAllSdkState,
} from '@shared/storage';
import { emit } from './diagnosticLogger';

declare const __SDK_FACADE_VERSION__: string;

export async function saveCheckpoint(
  facade: WalletFacade,
  txHistoryStorage: InMemoryTransactionHistoryStorage,
  environment: Environment,
  accountIndex: number,
  walletId: string,
): Promise<void> {
  const [shieldedState, unshieldedState, dustState] =
    await Promise.all([
      facade.shielded.serializeState(),
      facade.unshielded.serializeState(),
      facade.dust.serializeState(),
    ]);

  const state: PersistedSdkState = {
    key: `${environment}:${accountIndex}:${walletId}`,
    environment,
    accountIndex,
    shieldedState,
    unshieldedState,
    dustState,
    txHistoryState: txHistoryStorage.serialize(),
    savedAt: Date.now(),
    sdkVersion: __SDK_FACADE_VERSION__,
  };

  await saveSdkState(state);
  emit(
    'debug',
    'storage',
    'Checkpoint saved',
    { environment, accountIndex },
  );
}

export async function loadCheckpoint(
  environment: Environment,
  accountIndex: number,
  walletId: string,
): Promise<PersistedSdkState | null> {
  const state = await getSdkState(environment, accountIndex, walletId);
  if (!state) {
    return null;
  }

  if (state.sdkVersion !== __SDK_FACADE_VERSION__) {
    emit(
      'info',
      'storage',
      'Checkpoint SDK version mismatch, discarding',
      {
        stored: state.sdkVersion,
        current: __SDK_FACADE_VERSION__,
      },
    );
    await deleteSdkState(environment, accountIndex, walletId);
    return null;
  }

  return state;
}

export async function clearCheckpoint(
  environment: Environment,
  accountIndex: number,
  walletId: string,
): Promise<void> {
  await deleteSdkState(environment, accountIndex, walletId);
  emit(
    'debug',
    'storage',
    'Checkpoint cleared',
    { environment, accountIndex },
  );
}

export async function clearAllCheckpoints(): Promise<void> {
  await deleteAllSdkState();
  emit('debug', 'storage', 'All checkpoints cleared');
}
