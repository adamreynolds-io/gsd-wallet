import { prove } from '@midnight-ntwrk/zkir-v2';
import type { KeyMaterialProvider } from '@midnight-ntwrk/zkir-v2';
import type { DeviceBenchmark } from '@shared/types';

const BENCHMARK_K = 10;
const BENCHMARK_FIXTURE_PATH = 'data/proving/benchmark-k10.fixture';

/**
 * Runs a device benchmark to measure WASM proving speed.
 * Uses a k=10 proof fixture to measure wall-clock time, then
 * extrapolates estimates for k=10 through k=20.
 *
 * @param keyMaterialProvider Provider for BLS params and proving keys.
 * @returns Benchmark result with timing and extrapolated estimates.
 * @throws Error if the benchmark fixture is missing from the extension bundle.
 */
export async function runBenchmark(
  keyMaterialProvider: KeyMaterialProvider,
): Promise<DeviceBenchmark> {
  await keyMaterialProvider.getParams(BENCHMARK_K);

  const fixtureUrl = chrome.runtime.getURL(BENCHMARK_FIXTURE_PATH);
  const fixtureResponse = await fetch(fixtureUrl);
  if (!fixtureResponse.ok) {
    throw new Error(
      `Benchmark fixture not found at ${BENCHMARK_FIXTURE_PATH}. ` +
      'The fixture binary must be included in the extension bundle.',
    );
  }
  const fixtureBuf = await fixtureResponse.arrayBuffer();
  const fixture = new Uint8Array(fixtureBuf);

  const t0 = Date.now();
  await prove(fixture, keyMaterialProvider);
  const k10TimeMs = Date.now() - t0;

  const estimates: Record<number, number> = {};
  for (let k = BENCHMARK_K; k <= 20; k++) {
    estimates[k] = k10TimeMs * Math.pow(2, k - BENCHMARK_K);
  }

  return {
    k10TimeMs,
    timestamp: Date.now(),
    estimates,
  };
}
