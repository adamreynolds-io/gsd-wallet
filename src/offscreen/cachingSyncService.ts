import { Chunk, Duration, Effect, Either, pipe, Schedule, Scope, Stream } from 'effect';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { ZswapEvents } from '@midnight-ntwrk/wallet-sdk-indexer-client';
import {
  ConnectionHelper,
  WsSubscriptionClient,
} from '@midnight-ntwrk/wallet-sdk-indexer-client/effect';
import { WsURL } from '@midnight-ntwrk/wallet-sdk-utilities/networking';
import { Sync, WalletError, CoreWallet } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { getNetworkEvents, getMaxEventId, putNetworkEvents } from '@shared/storage';
import { emit } from './diagnosticLogger';

type DefaultSyncConfiguration = Sync.DefaultSyncConfiguration;
type WalletSyncUpdate = Sync.WalletSyncUpdate;
type EventsSyncUpdate = Sync.EventsSyncUpdate;

const { WalletSyncUpdate } = Sync;
const { SyncWalletError } = WalletError;
type SyncWalletError = WalletError.SyncWalletError;

/**
 * Decodes a hex-encoded raw event payload into an `EventsSyncUpdate`.
 *
 * @param id Event id from the indexer.
 * @param raw Hex-encoded serialized ledger event.
 * @param maxId Highest event id known at publication time.
 * @returns Decoded `EventsSyncUpdate`.
 */
function decodeEventPayload(id: number, raw: string, maxId: number): EventsSyncUpdate {
  const bytes = new Uint8Array(Buffer.from(raw, 'hex'));
  const event = ledger.Event.deserialize(bytes);
  return { _tag: 'EventsSyncUpdate', id, maxId, event };
}

/**
 * Builds a stream that replays cached shielded events from IndexedDB.
 */
function makeCachedStream(
  network: string,
  fromId: number,
  batchSize: number,
  secretKeys: ledger.ZswapSecretKeys,
): Stream.Stream<WalletSyncUpdate, SyncWalletError> {
  return pipe(
    Stream.fromEffect(
      Effect.promise(async () => {
        const events = await getNetworkEvents(network, 'zswap', fromId);
        if (events.length > 0) {
          const maxId = events[events.length - 1]?.id ?? fromId;
          emit('info', 'sync', `Syncing shielded from cache: ${events.length} events (${fromId}→${maxId})`, {
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
    Stream.map((data) => WalletSyncUpdate.create(data, secretKeys)),
    Stream.schedule(Schedule.spaced(Duration.millis(1))),
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
    emit('error', 'sync', `WebSocket URL resolution failed`, {
      httpUrl: config.indexerClientConnection.indexerHttpUrl,
      wsUrl: config.indexerClientConnection.indexerWsUrl,
      error: String(result.left),
    });
  }
  return result;
}

/**
 * Builds the live WebSocket subscription stream for shielded (zswap) events.
 *
 * Subscribes from `startFrom`, caches raw hex payloads to IndexedDB as they
 * arrive, decodes them, and emits batched `WalletSyncUpdate` values.
 */
function makeLiveStream(
  network: string,
  startFrom: number,
  config: DefaultSyncConfiguration,
  secretKeys: ledger.ZswapSecretKeys,
): Stream.Stream<WalletSyncUpdate, SyncWalletError, Scope.Scope> {
  const batchSize = config.batchSize ?? 10;
  const wsUrlResult = resolveWsUrl(config);

  if (Either.isLeft(wsUrlResult)) {
    return Stream.fail(wsUrlResult.left);
  }

  emit('info', 'sync', `Starting live zswap subscription from id ${startFrom}`, { network });

  return pipe(
    ZswapEvents.run({ id: startFrom }),
    Stream.provideLayer(
      WsSubscriptionClient.layer({
        url: wsUrlResult.right,
        keepAlive: config.indexerClientConnection.keepAlive,
      }),
    ),
    Stream.mapError((err) => new SyncWalletError({ message: String(err), cause: err })),
    Stream.map((subscription) => subscription.zswapLedgerEvents as { id: number; raw: string; maxId: number }),
    Stream.groupedWithin(batchSize, Duration.millis(1)),
    Stream.map(Chunk.toArray),
    Stream.mapEffect((batch) => {
      // Fire-and-forget cache write — don't block the sync pipeline
      void putNetworkEvents(network, 'zswap', batch);
      return Effect.try({
        try: () => batch.map((e) => decodeEventPayload(e.id, e.raw, e.maxId)),
        catch: (err) => new SyncWalletError({ message: String(err), cause: err }),
      });
    }),
    Stream.map((data) => WalletSyncUpdate.create(data, secretKeys)),
    Stream.schedule(Schedule.spaced(Duration.millis(4))),
  );
}

/**
 * Creates a caching shielded sync service factory compatible with
 * `V1Builder.withSync()`.
 *
 * On the first call to `updates()`, cached events from IndexedDB are replayed
 * before switching to the live WebSocket subscription. On subsequent calls
 * (SDK retries after stream errors), the cache replay is skipped so that only
 * the live connection is retried — avoiding repeated deserialization of
 * already-seen events.
 *
 * New live events are written to IndexedDB as they arrive so that other
 * wallets on the same network can benefit from the shared cache.
 *
 * @param network Network identifier used as the IndexedDB partition key
 *   (typically the environment name, e.g. `"mainnet"`).
 * @returns A sync service factory with the same signature as
 *   `makeEventsSyncService`.
 */
export function makeCachingShieldedSyncService(
  network: string,
  skipCache = false,
  preScanned = false,
): (config: DefaultSyncConfiguration) => Sync.SyncService<CoreWallet, ledger.ZswapSecretKeys, WalletSyncUpdate> {
  return (config) => ({
    updates: (state, secretKeys) => {
      const appliedIndex = Number(state.progress?.appliedIndex ?? 0n);
      const batchSize = config.batchSize ?? 10;

      if (skipCache) {
        return makeLiveStream(network, appliedIndex, config, secretKeys);
      }

      const cachedStream = preScanned
        ? makePreScannedStream(network, appliedIndex, secretKeys)
        : makeCachedStream(network, appliedIndex, batchSize, secretKeys);

      const liveStream = pipe(
        Stream.fromEffect(Effect.promise(() => getMaxEventId(network, 'zswap'))),
        Stream.flatMap((maxCachedId) => {
          const startFrom = Math.max(appliedIndex, maxCachedId);
          return makeLiveStream(network, startFrom, config, secretKeys);
        }),
      );

      return Stream.concat(cachedStream, liveStream);
    },
  });
}

/**
 * Sync capability that advances progress without calling `replayEvents`.
 *
 * Used after scan workers confirmed zero matches — events don't need
 * deserialization or application, just progress counter advancement.
 */
export function makeSkipReplayShieldedSyncCapability(): Sync.SyncCapability<CoreWallet, WalletSyncUpdate> {
  return {
    applyUpdate: (state, wrappedUpdate) => {
      if (wrappedUpdate.updates.length === 0) return state;
      const lastUpdate = wrappedUpdate.updates[wrappedUpdate.updates.length - 1]!;
      return CoreWallet.updateProgress(state, {
        highestRelevantWalletIndex: BigInt(lastUpdate.maxId),
        appliedIndex: BigInt(lastUpdate.id),
        isConnected: true,
      });
    },
  };
}

/**
 * Builds a fast stream that reads cached event IDs without deserializing.
 *
 * Creates placeholder `EventsSyncUpdate` entries with only `id`/`maxId` set.
 * The `event` field is a dummy — the skip-replay capability never accesses it.
 */
function makePreScannedStream(
  network: string,
  fromId: number,
  secretKeys: ledger.ZswapSecretKeys,
): Stream.Stream<WalletSyncUpdate, SyncWalletError> {
  return pipe(
    Stream.fromEffect(
      Effect.promise(async () => {
        const events = await getNetworkEvents(network, 'zswap', fromId);
        if (events.length > 0) {
          const maxId = events[events.length - 1]?.id ?? fromId;
          emit('info', 'sync', `Fast-forwarding shielded: ${events.length} pre-scanned events (${fromId}→${maxId})`, {
            network,
            count: events.length,
          });
        }
        return events;
      }),
    ),
    Stream.flatMap((events) => Stream.fromIterable(events)),
    Stream.map((cached) => ({
      _tag: 'EventsSyncUpdate' as const,
      id: cached.id,
      maxId: cached.maxId,
      event: null as unknown as ledger.Event,
    })),
    Stream.groupedWithin(100, Duration.millis(1)),
    Stream.map(Chunk.toArray),
    Stream.map((data) => WalletSyncUpdate.create(data, secretKeys)),
  );
}

/**
 * Creates a cache-only shielded sync service for use in replay workers.
 *
 * Returns only the cached event stream — no live WebSocket subscription.
 * No `Schedule.spaced` yield since the worker has exclusive CPU access.
 * The stream ends after all cached events have been emitted.
 */
export function makeCacheOnlyShieldedSyncService(
  network: string,
): (config: DefaultSyncConfiguration) => Sync.SyncService<CoreWallet, ledger.ZswapSecretKeys, WalletSyncUpdate> {
  return () => ({
    updates: (state, secretKeys) => {
      const appliedIndex = Number(state.progress?.appliedIndex ?? 0n);
      return pipe(
        Stream.fromEffect(
          Effect.promise(async () => {
            const events = await getNetworkEvents(network, 'zswap', appliedIndex);
            if (events.length > 0) {
              const maxId = events[events.length - 1]?.id ?? appliedIndex;
              emit('info', 'sync', `Worker: replaying ${events.length} shielded events (${appliedIndex}→${maxId})`, {
                network,
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
        Stream.groupedWithin(10, Duration.millis(1)),
        Stream.map(Chunk.toArray),
        Stream.map((data) => WalletSyncUpdate.create(data, secretKeys)),
      );
    },
  });
}
