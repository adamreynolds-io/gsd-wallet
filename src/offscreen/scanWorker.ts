// Polyfill Node.js Buffer for Midnight SDK — MUST be first
import { Buffer } from 'buffer';
(globalThis as Record<string, unknown>)['Buffer'] = Buffer;

// Polyfill Node.js assert for SDK internals
const assertFn = (condition: unknown, message?: string) => {
  if (!condition) throw new Error(message ?? 'Assertion failed');
};
assertFn.default = assertFn;
(globalThis as Record<string, unknown>)['assert'] = assertFn;

import * as ledger from '@midnight-ntwrk/ledger-v8';
import { CoreWallet as ShieldedCoreWallet } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { CoreWallet as DustCoreWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet/v1';
import { getNetworkEventsInRange } from '@shared/storage';

export interface ScanRequest {
  type: 'zswap' | 'dust';
  network: string;
  networkId: string;
  seed: number[];
  fromId: number;
  toId: number;
}

export type ScanResponse =
  | {
      type: 'DONE';
      matched: boolean;
      fromId: number;
      toId: number;
      lastEventId: number;
      maxId: number;
      coinCount: number;
      eventCount: number;
    }
  | {
      type: 'ERROR';
      error: string;
    };

async function handleScan(request: ScanRequest): Promise<void> {
  const { type, network, networkId, seed, fromId, toId } = request;
  console.log(`[scanWorker] Scanning ${type} events ${fromId}→${toId} on ${network}`);

  if (type === 'zswap') {
    const secretKeys = ledger.ZswapSecretKeys.fromSeed(new Uint8Array(seed));
    let wallet = ShieldedCoreWallet.initEmpty(secretKeys, networkId);

    const cachedEvents = await getNetworkEventsInRange(network, 'zswap', fromId, toId);

    if (cachedEvents.length === 0) {
      console.log(`[scanWorker] No zswap events in range ${fromId}→${toId}`);
      const response: ScanResponse = {
        type: 'DONE',
        matched: false,
        fromId,
        toId,
        lastEventId: fromId,
        maxId: 0,
        coinCount: 0,
        eventCount: 0,
      };
      self.postMessage(response);
      return;
    }

    const events = cachedEvents.map((e) => {
      const bytes = new Uint8Array(Buffer.from(e.raw, 'hex'));
      return ledger.Event.deserialize(bytes);
    });

    wallet = ShieldedCoreWallet.replayEvents(wallet, secretKeys, events);

    const coinCount = Object.keys(wallet.coinHashes).length;
    const matched = coinCount > 0;
    // Non-empty array guaranteed — length === 0 case returned early above
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const lastEvent = cachedEvents[cachedEvents.length - 1]!;

    console.log(
      `[scanWorker] zswap scan complete: ${coinCount} coins, ${cachedEvents.length} events`,
    );

    const response: ScanResponse = {
      type: 'DONE',
      matched,
      fromId,
      toId,
      lastEventId: lastEvent.id,
      maxId: lastEvent.maxId,
      coinCount,
      eventCount: cachedEvents.length,
    };
    self.postMessage(response);
  } else {
    const secretKey = ledger.DustSecretKey.fromSeed(new Uint8Array(seed));
    const dustParams = ledger.LedgerParameters.initialParameters().dust;
    let wallet = DustCoreWallet.initEmpty(dustParams, secretKey, networkId);

    const cachedEvents = await getNetworkEventsInRange(network, 'dust', fromId, toId);

    if (cachedEvents.length === 0) {
      console.log(`[scanWorker] No dust events in range ${fromId}→${toId}`);
      const response: ScanResponse = {
        type: 'DONE',
        matched: false,
        fromId,
        toId,
        lastEventId: fromId,
        maxId: 0,
        coinCount: 0,
        eventCount: 0,
      };
      self.postMessage(response);
      return;
    }

    const events = cachedEvents.map((e) => {
      const bytes = new Uint8Array(Buffer.from(e.raw, 'hex'));
      return ledger.Event.deserialize(bytes);
    });

    wallet = DustCoreWallet.applyEvents(wallet, secretKey, events, new Date());

    const coinCount = wallet.pendingDust.length;
    const matched = coinCount > 0;
    // Non-empty array guaranteed — length === 0 case returned early above
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const lastEvent = cachedEvents[cachedEvents.length - 1]!;

    console.log(
      `[scanWorker] dust scan complete: ${coinCount} pending dust, ${cachedEvents.length} events`,
    );

    const response: ScanResponse = {
      type: 'DONE',
      matched,
      fromId,
      toId,
      lastEventId: lastEvent.id,
      maxId: lastEvent.maxId,
      coinCount,
      eventCount: cachedEvents.length,
    };
    self.postMessage(response);
  }
}

self.onmessage = (e: MessageEvent) => {
  handleScan(e.data as ScanRequest).catch((err: unknown) => {
    console.error(`[scanWorker] Error:`, err);
    const response: ScanResponse = { type: 'ERROR', error: String(err) };
    self.postMessage(response);
  });
};
