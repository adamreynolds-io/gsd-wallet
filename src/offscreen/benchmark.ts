import { prove } from '@midnight-ntwrk/zkir-v2';
import type { KeyMaterialProvider } from '@midnight-ntwrk/zkir-v2';
import type { DeviceBenchmark } from '@shared/types';

const PREIMAGES = [
  { k: 10, path: 'data/proving/benchmark-k10.preimage' },
  { k: 11, path: 'data/proving/benchmark-k11.preimage' },
];

/**
 * Runs a device benchmark by proving bundled k=10 and k=11 preimages
 * via WASM. Uses both data points for a better-calibrated doubling
 * model extrapolation across k=9 through k=20.
 *
 * @param keyMaterialProvider Provider for BLS params and proving keys.
 */
export async function runBenchmark(
  keyMaterialProvider: KeyMaterialProvider,
): Promise<DeviceBenchmark> {
  const timings: Array<{ k: number; ms: number }> = [];

  for (const { k, path } of PREIMAGES) {
    const url = `${self.location.origin}/${path}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Benchmark preimage not found at ${path}. ` +
        'Run scripts/fetch-proving-data.sh first.',
      );
    }
    const preimage = new Uint8Array(await response.arrayBuffer());

    await keyMaterialProvider.getParams(k);

    const t0 = Date.now();
    await prove(preimage, keyMaterialProvider);
    timings.push({ k, ms: Date.now() - t0 });
  }

  return computeBenchmarkFromTimings(timings);
}

/**
 * Computes a device benchmark from observed WASM proof timings.
 * Averages the per-k normalized base times for a better fit,
 * then extrapolates via the doubling model.
 */
function computeBenchmarkFromTimings(
  timings: Array<{ k: number; ms: number }>,
): DeviceBenchmark {
  const BASE_K = 10;

  // Normalize each observation to k=10 equivalent
  let k10Sum = 0;
  for (const { k, ms } of timings) {
    k10Sum += ms / Math.pow(2, k - BASE_K);
  }
  const k10TimeMs = Math.round(k10Sum / timings.length);

  const estimates: Record<number, number> = {};
  for (let k = 9; k <= 20; k++) {
    estimates[k] = Math.round(
      k10TimeMs * Math.pow(2, k - BASE_K),
    );
  }

  return { k10TimeMs, timestamp: Date.now(), estimates };
}

/**
 * Computes a device benchmark from a single observed WASM proof timing.
 * Used to refine estimates after real transactions.
 */
export function computeBenchmark(
  observedK: number,
  observedMs: number,
): DeviceBenchmark {
  return computeBenchmarkFromTimings([
    { k: observedK, ms: observedMs },
  ]);
}
