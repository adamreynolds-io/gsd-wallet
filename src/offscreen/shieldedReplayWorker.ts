// Polyfill Node.js Buffer for Polkadot/Substrate SDK — MUST be first
import { Buffer } from 'buffer';
(globalThis as Record<string, unknown>)['Buffer'] = Buffer;

// Polyfill Node.js assert for @subsquid/scale-codec
if (!(globalThis as Record<string, unknown>)['assert']) {
  const assertFn = (condition: unknown, message?: string) => {
    if (!condition) throw new Error(message ?? 'Assertion failed');
  };
  assertFn.default = assertFn;
  (globalThis as Record<string, unknown>)['assert'] = assertFn;
}

import * as ledger from '@midnight-ntwrk/ledger-v8';
import { CustomShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { V1Builder as ShieldedV1Builder, Sync as ShieldedSync } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import type { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { makeCacheOnlyShieldedSyncService } from './cachingSyncService';
import { getMaxEventId } from '@shared/storage';

interface ReplayRequest {
  network: string;
  networkId: NetworkId.NetworkId;
  seed: Uint8Array;
}

type ReplayResponse =
  | { type: 'DONE'; serializedState: string; maxEventId: number }
  | { type: 'ERROR'; error: string };

async function handleReplay(request: ReplayRequest): Promise<void> {
  const { network, networkId, seed } = request;

  console.log(`[shieldedReplayWorker] Starting replay for network=${network}`);

  const secretKeys = ledger.ZswapSecretKeys.fromSeed(seed);

  const builder = new ShieldedV1Builder()
    .withDefaultTransactionType()
    .withSync(makeCacheOnlyShieldedSyncService(network), ShieldedSync.makeEventsSyncCapability)
    .withSerializationDefaults()
    .withTransactingDefaults()
    .withCoinSelectionDefaults()
    .withCoinsAndBalancesDefaults()
    .withTransactionHistoryDefaults()
    .withKeysDefaults();

  const config = {
    networkId,
    indexerClientConnection: { indexerHttpUrl: '', indexerWsUrl: '' },
  };

  const wallet = CustomShieldedWallet(config, builder).startWithSecretKeys(secretKeys);

  try {
    await wallet.start(secretKeys);
    await wallet.waitForSyncedState();

    const serializedState = await wallet.serializeState();
    const maxEventId = await getMaxEventId(network, 'zswap');

    console.log(`[shieldedReplayWorker] Replay complete, maxEventId=${maxEventId}`);

    const response: ReplayResponse = { type: 'DONE', serializedState, maxEventId };
    self.postMessage(response);
  } finally {
    await wallet.stop();
  }
}

self.onmessage = (e: MessageEvent) => {
  const request = e.data as ReplayRequest;
  handleReplay(request).catch((err: unknown) => {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[shieldedReplayWorker] Replay failed: ${error}`);
    const response: ReplayResponse = { type: 'ERROR', error };
    self.postMessage(response);
  });
};
