// Polyfill Node.js Buffer for SDK — MUST be first, before any SDK imports
import { Buffer } from 'buffer';
(globalThis as Record<string, unknown>)['Buffer'] = Buffer;

// Polyfill Node.js assert for @subsquid/scale-codec
if (!(globalThis as Record<string, unknown>)['assert']) {
  const assertFn = (condition: unknown, message?: string) => {
    if (!condition) throw new Error(message ?? 'Assertion failed');
  };
  (assertFn as unknown as Record<string, unknown>)['default'] = assertFn;
  (globalThis as Record<string, unknown>)['assert'] = assertFn;
}

import * as ledger from '@midnight-ntwrk/ledger-v8';
import {
  V1Builder as DustV1Builder,
  SyncService as DustSyncService,
} from '@midnight-ntwrk/wallet-sdk-dust-wallet/v1';
import type { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { CustomDustWallet } from './customDustWallet';
import { makeCacheOnlyDustSyncService } from './cachingDustSyncService';
import { getMaxEventId } from '@shared/storage';

interface ReplayRequest {
  network: string;
  networkId: NetworkId.NetworkId;
  seed: number[];
}

type ReplayResponse =
  | { type: 'DONE'; serializedState: string; maxEventId: number }
  | { type: 'ERROR'; error: string };

async function handleReplay(request: ReplayRequest): Promise<void> {
  const { network, networkId } = request;
  const seed = new Uint8Array(request.seed);

  const dustSecretKey = ledger.DustSecretKey.fromSeed(seed);
  const dustParameters = ledger.LedgerParameters.initialParameters().dust;

  const builder = new DustV1Builder()
    .withDefaultTransactionType()
    .withSync(makeCacheOnlyDustSyncService(network), DustSyncService.makeDefaultSyncCapability)
    .withSerializationDefaults()
    .withTransactingDefaults()
    .withCoinSelectionDefaults()
    .withCoinsAndBalancesDefaults()
    .withKeysDefaults();

  const config = {
    networkId,
    indexerClientConnection: { indexerHttpUrl: '', indexerWsUrl: '' },
    costParameters: { feeBlocksMargin: 5 },
  };

  const WalletClass = CustomDustWallet(config, builder);
  const wallet = WalletClass.startWithSeed(seed, dustParameters);

  try {
    await wallet.start(dustSecretKey);
    await wallet.waitForSyncedState();

    const serializedState = await wallet.serializeState();
    const maxEventId = await getMaxEventId(network, 'dust');

    const response: ReplayResponse = { type: 'DONE', serializedState, maxEventId };
    self.postMessage(response);
  } finally {
    await wallet.stop();
  }
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data as ReplayRequest;
  handleReplay(msg).catch((err: unknown) => {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[dustReplayWorker] replay failed:', error);
    const response: ReplayResponse = { type: 'ERROR', error };
    self.postMessage(response);
  });
};
