import { Chunk, Duration, Effect, Either, pipe, Schedule, Schema, Scope, Stream } from 'effect';
import type { DustSecretKey } from '@midnight-ntwrk/ledger-v8';
import { DustLedgerEvents } from '@midnight-ntwrk/wallet-sdk-indexer-client';
import {
  ConnectionHelper,
  WsSubscriptionClient,
} from '@midnight-ntwrk/wallet-sdk-indexer-client/effect';
import { WsURL } from '@midnight-ntwrk/wallet-sdk-utilities/networking';
import { SyncService as DustSyncService, type CoreWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet/v1';
// SyncWalletError is structurally identical across both wallet SDKs (_tag: 'Wallet.Sync').
// The dust v1 subpath doesn't re-export WalletError, so we borrow the shielded version.
import { WalletError as ShieldedWalletError } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { getNetworkEvents, getMaxEventId, putNetworkEvents } from '@shared/storage';
import { emit } from './diagnosticLogger';

type DefaultSyncConfiguration = DustSyncService.DefaultSyncConfiguration;
type WalletSyncUpdate = DustSyncService.WalletSyncUpdate;
type WalletSyncSubscription = DustSyncService.WalletSyncSubscription;

const { SyncEventsUpdateSchema, WalletSyncUpdate, makeDefaultSyncService } = DustSyncService;
const { SyncWalletError } = ShieldedWalletError;
type SyncWalletError = ShieldedWalletError.SyncWalletError;

/**
 * Decodes a hex-encoded raw dust event payload into a `WalletSyncSubscription`.
 *
 * Uses `SyncEventsUpdateSchema` which handles hex → `ledger.Event` deserialization.
 *
 * @param id Event id from the indexer.
 * @param raw Hex-encoded serialized ledger event.
 * @param maxId Highest event id known at publication time.
 * @returns Decoded `WalletSyncSubscription`.
 */
function decodeEventPayload(id: number, raw: string, maxId: number): WalletSyncSubscription {
  return Schema.decodeUnknownSync(SyncEventsUpdateSchema)({ id, raw, maxId });
}

/**
 * Builds a stream that replays cached dust events from IndexedDB.
 */
function makeCachedStream(
  network: string,
  fromId: number,
  secretKey: DustSecretKey,
): Stream.Stream<WalletSyncUpdate, SyncWalletError> {
  const batchSize = 10;
  return pipe(
    Stream.fromEffect(
      Effect.promise(async () => {
        const events = await getNetworkEvents(network, 'dust', fromId);
        if (events.length > 0) {
          const maxId = events[events.length - 1]?.id ?? fromId;
          emit('info', 'sync', `Syncing dust from cache: ${events.length} events (${fromId}→${maxId})`, {
            network,
            fromId,
            toId: maxId,
            count: events.length,
          });
        }
        return events;
      }),
    ),
    Stream.flatMap((events) => Stream.fromIterable(events)),
    Stream.mapEffect((cached) =>
      Effect.try({
        try: () => decodeEventPayload(cached.id, cached.raw, cached.maxId),
        catch: (err) => new SyncWalletError({ message: String(err), cause: err }),
      }),
    ),
    Stream.groupedWithin(batchSize, Duration.millis(1)),
    Stream.map(Chunk.toArray),
    Stream.map((data) => WalletSyncUpdate.create(data, secretKey, new Date())),
  );
}

/**
 * Derives and validates a WebSocket URL from the indexer connection config.
 *
 * Matches the SDK's two-step validation: `ConnectionHelper.createWebSocketUrl`
 * then `WsURL.make`.
 */
function resolveWsUrl(config: DefaultSyncConfiguration): Either.Either<WsURL.WsURL, SyncWalletError> {
  const result = pipe(
    ConnectionHelper.createWebSocketUrl(
      config.indexerClientConnection.indexerHttpUrl,
      config.indexerClientConnection.indexerWsUrl,
    ),
    Either.flatMap(WsURL.make),
    Either.mapLeft((err) =>
      new SyncWalletError({ message: `Invalid indexer WS URL: ${String(err)}`, cause: err }),
    ),
  );
  if (Either.isLeft(result)) {
    emit('error', 'sync', `Dust WebSocket URL resolution failed`, {
      httpUrl: config.indexerClientConnection.indexerHttpUrl,
      wsUrl: config.indexerClientConnection.indexerWsUrl,
      error: String(result.left),
    });
  }
  return result;
}

/**
 * Builds the live WebSocket subscription stream for dust events.
 *
 * Subscribes from `startFrom`, caches raw hex payloads to IndexedDB as they
 * arrive, decodes them via `SyncEventsUpdateSchema`, and emits batched
 * `WalletSyncUpdate` values.
 */
function makeLiveStream(
  network: string,
  startFrom: number,
  config: DefaultSyncConfiguration,
  secretKey: DustSecretKey,
): Stream.Stream<WalletSyncUpdate, SyncWalletError, Scope.Scope> {
  const batchSize = 10;
  const wsUrlResult = resolveWsUrl(config);

  if (Either.isLeft(wsUrlResult)) {
    return Stream.fail(wsUrlResult.left);
  }

  emit('info', 'sync', `Starting live dust subscription from id ${startFrom}`, { network });

  return pipe(
    DustLedgerEvents.run({ id: startFrom }),
    Stream.provideLayer(
      WsSubscriptionClient.layer({
        url: wsUrlResult.right,
        keepAlive: config.indexerClientConnection.keepAlive,
      }),
    ),
    Stream.mapError((err) => new SyncWalletError({ message: String(err), cause: err })),
    Stream.map((subscription) => subscription.dustLedgerEvents as { id: number; raw: string; maxId: number }),
    Stream.groupedWithin(batchSize, Duration.millis(1)),
    Stream.map(Chunk.toArray),
    Stream.mapEffect((batch) => {
      // Fire-and-forget cache write — don't block the sync pipeline
      void putNetworkEvents(network, 'dust', batch);
      return Effect.try({
        try: () => batch.map((e) => decodeEventPayload(e.id, e.raw, e.maxId)),
        catch: (err) => new SyncWalletError({ message: String(err), cause: err }),
      });
    }),
    Stream.map((data) => WalletSyncUpdate.create(data, secretKey, new Date())),
    Stream.schedule(Schedule.spaced(Duration.millis(4))),
  );
}

/**
 * Creates a caching dust sync service factory compatible with the dust
 * `V1Builder.withSync()`.
 *
 * On the first call to `updates()`, cached events from IndexedDB are replayed
 * before switching to the live WebSocket subscription. On subsequent calls
 * (SDK retries after stream errors), the cache replay is skipped.
 *
 * The required `blockData` method is delegated to the SDK's default sync
 * service so the indexer is queried for the latest block as usual.
 *
 * @param network Network identifier used as the IndexedDB partition key
 *   (typically the environment name, e.g. `"mainnet"`).
 * @returns A sync service factory with the same signature as
 *   `makeDefaultSyncService`.
 */
export function makeCachingDustSyncService(
  network: string,
): (config: DefaultSyncConfiguration) => DustSyncService.SyncService<CoreWallet, DustSecretKey, WalletSyncUpdate> {
  return (config) => {
    const defaultService = makeDefaultSyncService(config);

    return {
      updates: (state, secretKey) => {
        const appliedIndex = Number(state.progress.appliedIndex ?? 0n);

        const cachedStream = makeCachedStream(network, appliedIndex, secretKey);

        const liveStream = pipe(
          Stream.fromEffect(Effect.promise(() => getMaxEventId(network, 'dust'))),
          Stream.flatMap((maxCachedId) => {
            const startFrom = Math.max(appliedIndex, maxCachedId);
            return makeLiveStream(network, startFrom, config, secretKey);
          }),
        );

        return Stream.concat(cachedStream, liveStream) as ReturnType<
          DustSyncService.SyncService<CoreWallet, DustSecretKey, WalletSyncUpdate>['updates']
        >;
      },

      blockData: () => defaultService.blockData(),
    };
  };
}
