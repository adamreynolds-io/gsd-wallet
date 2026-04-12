import {
  makeServerProvingService,
} from '@midnight-ntwrk/wallet-sdk-capabilities/proving';
import type {
  ProvingService,
  UnboundTransaction,
} from '@midnight-ntwrk/wallet-sdk-capabilities/proving';
import type { KeyMaterialProvider } from '@midnight-ntwrk/zkir-v2';
import { makeLocalWasmProvingService } from './localWasmProver';
import type { DeviceBenchmark, ProvingStrategy, ProvingStatus, ProvingMode } from '@shared/types';
import { computeBenchmark } from './benchmark';

export interface CompositeProvingServiceConfig {
  serverUrl: URL;
  strategy: ProvingStrategy;
  onStatus: (status: ProvingStatus) => void;
  onBenchmark: (benchmark: DeviceBenchmark) => void;
  keyMaterialProvider: KeyMaterialProvider;
}

class KValueExceededError extends Error {
  readonly k: number;
  constructor(k: number, threshold: number) {
    super(`k=${k} exceeds threshold ${threshold}, routing to server`);
    this.name = 'KValueExceededError';
    this.k = k;
  }
}

class ProvingCancelledError extends Error {
  constructor() {
    super('Proving cancelled by user');
    this.name = 'ProvingCancelledError';
  }
}

/**
 * Creates a composite proving service that routes proofs to WASM or server
 * based on the k-value threshold in the strategy.
 *
 * @param config Service configuration including URL, strategy, and callbacks.
 * @returns Proving service handle with cancellation and strategy controls.
 */
export function createCompositeProvingService(config: CompositeProvingServiceConfig): {
  provingService: ProvingService<UnboundTransaction>;
  cancelCurrentProve: () => boolean;
  setStrategy: (strategy: ProvingStrategy) => void;
  getStrategy: () => ProvingStrategy;
} {
  let currentStrategy = config.strategy;
  let abortController: AbortController | null = null;
  let benchmarkRecorded = false;

  function emitStatus(status: ProvingStatus): void {
    config.onStatus(status);
  }

  function makeTrackingProvider(
    signal: AbortSignal,
    kThreshold: number,
    onKValue: (k: number) => void,
  ): KeyMaterialProvider {
    return {
      async lookupKey(keyLocation) {
        if (signal.aborted) throw new ProvingCancelledError();
        return config.keyMaterialProvider.lookupKey(keyLocation);
      },
      async getParams(k) {
        if (signal.aborted) throw new ProvingCancelledError();
        onKValue(k);
        if (k > kThreshold) throw new KValueExceededError(k, kThreshold);
        return config.keyMaterialProvider.getParams(k);
      },
    };
  }

  async function proveWithWasm(
    transaction: Parameters<ProvingService<UnboundTransaction>['prove']>[0],
    kThreshold: number,
  ): Promise<UnboundTransaction> {
    const controller = new AbortController();
    abortController = controller;

    const t0 = Date.now();
    let detectedK: number | undefined;

    emitStatus({ phase: 'loading-keys', activeProver: 'wasm' });

    const trackingProvider = makeTrackingProvider(
      controller.signal,
      kThreshold,
      (k) => {
        detectedK = k;
        emitStatus({ phase: 'proving', activeProver: 'wasm', kValue: k });
      },
    );

    const wasmService = makeLocalWasmProvingService({ keyMaterialProvider: trackingProvider });
    try {
      const result = await wasmService.prove(transaction);
      const elapsed = Date.now() - t0;
      emitStatus({
        phase: 'done',
        activeProver: 'wasm',
        elapsed,
        ...(detectedK !== undefined ? { kValue: detectedK } : {}),
      });
      if (!benchmarkRecorded && detectedK !== undefined && elapsed > 0) {
        benchmarkRecorded = true;
        config.onBenchmark(computeBenchmark(detectedK, elapsed));
      }
      return result;
    } finally {
      abortController = null;
    }
  }

  async function proveWithServer(
    transaction: Parameters<ProvingService<UnboundTransaction>['prove']>[0],
    reason: string,
    activeProver: ProvingMode,
  ): Promise<UnboundTransaction> {
    const t0 = Date.now();
    emitStatus({ phase: 'proving', activeProver: 'server', method: reason });
    const serverService = makeServerProvingService({ provingServerUrl: config.serverUrl });
    try {
      const result = await serverService.prove(transaction);
      emitStatus({
        phase: 'done',
        activeProver,
        elapsed: Date.now() - t0,
        method: reason,
      });
      return result;
    } catch (err) {
      emitStatus({
        phase: 'error',
        activeProver,
        elapsed: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  const provingService: ProvingService<UnboundTransaction> = {
    async prove(transaction) {
      const { kThreshold } = currentStrategy;

      try {
      if (kThreshold === 0) {
        return await proveWithServer(transaction, 'server-only', 'server');
      }

      if (kThreshold === Infinity) {
        // WASM-only: no server fallback on cancel or error
        try {
          return await proveWithWasm(transaction, Infinity);
        } catch (err) {
          if (err instanceof ProvingCancelledError) {
            emitStatus({ phase: 'cancelled', activeProver: null });
          } else {
            emitStatus({
              phase: 'error',
              activeProver: 'wasm',
              error: err instanceof Error ? err.message : String(err),
            });
          }
          throw err;
        }
      }

      // Hybrid: try WASM, fall back to server on k-exceeded or cancellation
      try {
        return await proveWithWasm(transaction, kThreshold);
      } catch (err) {
        if (err instanceof KValueExceededError) {
          config.onStatus({
            phase: 'proving',
            activeProver: 'server',
            kValue: err.k,
            method: 'k-exceeded-fallback',
          });
          return proveWithServer(transaction, 'k-exceeded-fallback', 'server');
        }
        if (err instanceof ProvingCancelledError) {
          emitStatus({ phase: 'cancelled', activeProver: null });
          return proveWithServer(transaction, 'cancelled-fallback', 'server');
        }
        emitStatus({
          phase: 'error',
          activeProver: 'wasm',
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      } finally {
        // Reset to idle so the UI clears the proving indicator
        emitStatus({ phase: 'idle', activeProver: null });
      }
    },
  };

  return {
    provingService,
    cancelCurrentProve(): boolean {
      if (abortController) {
        abortController.abort();
        return true;
      }
      return false;
    },
    setStrategy(strategy: ProvingStrategy): void {
      currentStrategy = strategy;
    },
    getStrategy(): ProvingStrategy {
      return currentStrategy;
    },
  };
}
