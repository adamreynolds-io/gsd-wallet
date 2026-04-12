import { prove, Zkir, jsonIrToBinary } from '@midnight-ntwrk/zkir-v2';
import type { KeyMaterialProvider } from '@midnight-ntwrk/zkir-v2';
import type { DeviceBenchmark } from '@shared/types';

const BENCHMARK_K = 10;
const BENCHMARK_ZKIR_PATH = 'data/proving/benchmark-k10.zkir';

/**
 * Runs a device benchmark to measure WASM proving speed.
 * Loads a k=10 ZKIR circuit, converts to binary preimage, proves it,
 * then extrapolates estimates for k=9 through k=20.
 *
 * @param keyMaterialProvider Provider for BLS params and proving keys.
 * @returns Benchmark result with timing and extrapolated estimates.
 */
export async function runBenchmark(
  keyMaterialProvider: KeyMaterialProvider,
): Promise<DeviceBenchmark> {
  const zkirUrl = `${self.location.origin}/${BENCHMARK_ZKIR_PATH}`;
  const response = await fetch(zkirUrl);
  if (!response.ok) {
    throw new Error(
      `Benchmark ZKIR not found at ${BENCHMARK_ZKIR_PATH}. ` +
      'Run scripts/fetch-proving-data.sh first.',
    );
  }
  const zkirJson = await response.text();
  const preimage = jsonIrToBinary(zkirJson);

  // Pre-load BLS params so the timing measures proving only
  await keyMaterialProvider.getParams(BENCHMARK_K);

  const t0 = Date.now();
  await prove(preimage, keyMaterialProvider);
  const k10TimeMs = Date.now() - t0;

  const estimates: Record<number, number> = {};
  for (let k = 9; k <= 20; k++) {
    estimates[k] = k10TimeMs * Math.pow(2, k - BENCHMARK_K);
  }

  return {
    k10TimeMs,
    timestamp: Date.now(),
    estimates,
  };
}
