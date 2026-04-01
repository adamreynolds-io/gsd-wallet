// This file is part of GSD Wallet.
// SPDX-License-Identifier: Apache-2.0
//
// Mirrors `DustWallet(configuration)` from `@midnight-ntwrk/wallet-sdk-dust-wallet`
// but accepts a caller-supplied `VariantBuilder` so a custom sync service can be
// injected (e.g. the caching sync service that writes events to IndexedDB).
import { DustSecretKey } from '@midnight-ntwrk/ledger-v8';
import type { DustParameters, FinalizedTransaction, Signature, SignatureVerifyingKey, UnprovenTransaction } from '@midnight-ntwrk/ledger-v8';
import { ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { WalletBuilder } from '@midnight-ntwrk/wallet-sdk-runtime';
import type { VariantBuilder } from '@midnight-ntwrk/wallet-sdk-runtime/abstractions';
import { Effect, Either } from 'effect';
import * as rx from 'rxjs';
import {
  DustWalletState,
  type DustWalletClass,
  type DefaultDustConfiguration,
} from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import {
  CoreWallet,
  V1Tag,
  type DefaultV1Variant,
  type RunningV1Variant,
  type AnyTransaction,
  type UtxoWithMeta,
} from '@midnight-ntwrk/wallet-sdk-dust-wallet/v1';

// The default running variant type used by the SDK's DustWallet.
type DefaultRunningV1 = RunningV1Variant<string, unknown, FinalizedTransaction, DustSecretKey>;

/**
 * Creates a `DustWalletClass` using a caller-supplied `VariantBuilder` rather
 * than the SDK's default `V1Builder().withDefaults()`.
 *
 * This is the dust-wallet equivalent of `CustomShieldedWallet` from the
 * shielded SDK: it lets callers inject a custom sync service (e.g. one that
 * caches events in IndexedDB) without forking the wallet implementation.
 *
 * @param configuration Wallet configuration (network, indexer, cost params…).
 * @param builder A fully-configured `V1Builder` variant builder.
 * @returns A `DustWalletClass` whose static methods (`startWithSeed`,
 *   `startWithSecretKey`, `restore`) behave identically to `DustWallet()`.
 */
export function CustomDustWallet(
  configuration: DefaultDustConfiguration,
  builder: VariantBuilder.VariantBuilder<DefaultV1Variant, DefaultDustConfiguration>,
): DustWalletClass {
  const BaseWallet = WalletBuilder.init()
    .withVariant(ProtocolVersion.MinSupportedVersion, builder)
    .build(configuration);

  return class DustWalletImplementation extends BaseWallet {
    static startWithSeed(seed: Uint8Array, dustParameters: DustParameters) {
      const dustSecretKey = DustSecretKey.fromSeed(seed);
      return DustWalletImplementation.startFirst(
        DustWalletImplementation,
        CoreWallet.initEmpty(dustParameters, dustSecretKey, configuration.networkId),
      );
    }

    static startWithSecretKey(secretKey: DustSecretKey, dustParameters: DustParameters) {
      return DustWalletImplementation.startFirst(
        DustWalletImplementation,
        CoreWallet.initEmpty(dustParameters, secretKey, configuration.networkId),
      );
    }

    static restore(serializedState: string) {
      const deserialized = DustWalletImplementation.allVariantsRecord()[V1Tag].variant
        .deserializeState(serializedState)
        .pipe(Either.getOrThrow);
      return DustWalletImplementation.startFirst(DustWalletImplementation, deserialized);
    }

    readonly state: rx.Observable<DustWalletState>;

    constructor(runtime: ConstructorParameters<typeof BaseWallet>[0], scope: ConstructorParameters<typeof BaseWallet>[1]) {
      super(runtime, scope);
      this.state = this.rawState.pipe(
        rx.map(DustWalletState.mapState(DustWalletImplementation.allVariantsRecord()[V1Tag].variant)),
        rx.shareReplay({ refCount: true, bufferSize: 1 }),
      );
    }

    start(secretKey: DustSecretKey): Promise<void> {
      return this.runtime.dispatch({
        [V1Tag]: (v1: DefaultRunningV1) => v1.startSyncInBackground(secretKey),
      }).pipe(Effect.runPromise);
    }

    createDustGenerationTransaction(
      currentTime: Date | undefined,
      ttl: Date,
      nightUtxos: Array<UtxoWithMeta>,
      nightVerifyingKey: SignatureVerifyingKey,
      dustReceiverAddress: DustAddress | undefined,
    ): Promise<UnprovenTransaction> {
      return this.runtime.dispatch({
        [V1Tag]: (v1: DefaultRunningV1) =>
          v1.createDustGenerationTransaction(currentTime, ttl, nightUtxos, nightVerifyingKey, dustReceiverAddress),
      }).pipe(Effect.runPromise);
    }

    addDustGenerationSignature(
      transaction: UnprovenTransaction,
      signature: Signature,
    ): Promise<UnprovenTransaction> {
      return this.runtime.dispatch({
        [V1Tag]: (v1: DefaultRunningV1) => v1.addDustGenerationSignature(transaction, signature),
      }).pipe(Effect.runPromise);
    }

    calculateFee(transactions: ReadonlyArray<AnyTransaction>): Promise<bigint> {
      return this.runtime.dispatch({
        [V1Tag]: (v1: DefaultRunningV1) => v1.calculateFee(transactions),
      }).pipe(Effect.runPromise);
    }

    estimateFee(
      secretKey: DustSecretKey,
      transactions: ReadonlyArray<AnyTransaction>,
      ttl?: Date,
      currentTime?: Date,
    ): Promise<bigint> {
      const effectiveTtl = ttl ?? new Date(Date.now() + 60 * 60 * 1000);
      return this.runtime.dispatch({
        [V1Tag]: (v1: DefaultRunningV1) => v1.estimateFee(secretKey, transactions, effectiveTtl, currentTime),
      }).pipe(Effect.runPromise);
    }

    balanceTransactions(
      secretKey: DustSecretKey,
      transactions: ReadonlyArray<AnyTransaction>,
      ttl: Date,
      currentTime?: Date,
    ): Promise<UnprovenTransaction> {
      return this.runtime.dispatch({
        [V1Tag]: (v1: DefaultRunningV1) => v1.balanceTransactions(secretKey, transactions, ttl, currentTime),
      }).pipe(Effect.runPromise);
    }

    revertTransaction(transaction: AnyTransaction): Promise<void> {
      return this.runtime.dispatch({
        [V1Tag]: (v1: DefaultRunningV1) => v1.revertTransaction(transaction),
      }).pipe(Effect.runPromise);
    }

    waitForSyncedState(allowedGap = 0n): Promise<DustWalletState> {
      return rx.firstValueFrom(
        this.state.pipe(rx.filter((state) => state.state.progress.isCompleteWithin(allowedGap))),
      );
    }

    serializeState(): Promise<string> {
      return rx.firstValueFrom(this.state).then((state) => state.serialize());
    }

    getAddress(): Promise<DustAddress> {
      return rx.firstValueFrom(this.state).then((state) => state.address);
    }
  } as unknown as DustWalletClass;
}
