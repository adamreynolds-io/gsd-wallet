import type { DeviceBenchmark } from '@shared/types';

const BENCHMARK_K = 10;

/**
 * Computes a device benchmark from an observed WASM proof timing.
 * Uses the doubling model: time(k) = observedMs * 2^(k - observedK).
 * Normalizes to k=10 base, then extrapolates for k=9 through k=20.
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
