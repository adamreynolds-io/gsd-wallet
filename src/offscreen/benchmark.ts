import { prove } from '@midnight-ntwrk/zkir-v2';
import type { KeyMaterialProvider } from '@midnight-ntwrk/zkir-v2';
import type { DeviceBenchmark } from '@shared/types';

const BENCHMARK_K = 10;
const PREIMAGE_PATH = 'data/proving/benchmark-k10.preimage';

/**
 * Runs a device benchmark by proving a bundled k=10 preimage via WASM.
 * Extrapolates estimates for k=9 through k=20 via the doubling model.
 *
 * @param keyMaterialProvider Provider for BLS params and proving keys.
 */
export async function runBenchmark(
  keyMaterialProvider: KeyMaterialProvider,
): Promise<DeviceBenchmark> {
  const url = `${self.location.origin}/${PREIMAGE_PATH}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Benchmark preimage not found at ${PREIMAGE_PATH}. ` +
      'Run scripts/fetch-proving-data.sh first.',
    );
  }
  const preimage = new Uint8Array(await response.arrayBuffer());

  // Pre-load BLS params so timing measures proving only
  await keyMaterialProvider.getParams(BENCHMARK_K);

  const t0 = Date.now();
  await prove(preimage, keyMaterialProvider);
  const k10TimeMs = Date.now() - t0;

  return computeBenchmark(BENCHMARK_K, k10TimeMs);
}

/**
 * Computes a device benchmark from an observed WASM proof timing.
 * Uses the doubling model: time(k) = observedMs * 2^(k - observedK).
 *
 * @param observedK The k-value of the observed proof.
 * @param observedMs Wall-clock milliseconds for the observed proof.
 */
export function computeBenchmark(
  observedK: number,
  observedMs: number,
): DeviceBenchmark {
  const k10TimeMs = observedMs / Math.pow(2, observedK - BENCHMARK_K);

  const estimates: Record<number, number> = {};
  for (let k = 9; k <= 20; k++) {
    estimates[k] = Math.round(
      k10TimeMs * Math.pow(2, k - BENCHMARK_K),
    );
  }

  return {
    k10TimeMs: Math.round(k10TimeMs),
    timestamp: Date.now(),
    estimates,
  };
}
