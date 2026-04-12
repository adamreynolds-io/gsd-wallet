import { prove } from '@midnight-ntwrk/zkir-v2';
import type { KeyMaterialProvider, ProvingKeyMaterial } from '@midnight-ntwrk/zkir-v2';
import type { DeviceBenchmark } from '@shared/types';

const BENCH_BASE = 'data/proving/bench';

const PREIMAGES = [
  { k: 10, circuit: 'bench_k10', path: 'data/proving/benchmark-k10.preimage' },
  { k: 11, circuit: 'bench_k11', path: 'data/proving/benchmark-k11.preimage' },
];

function extensionURL(path: string): string {
  return `${self.location.origin}/${path}`;
}

async function fetchExtension(path: string): Promise<Uint8Array> {
  const response = await fetch(extensionURL(path));
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Creates a KeyMaterialProvider for benchmark circuits.
 * Resolves bench_k10/bench_k11 keys from bundled files, and
 * delegates BLS params to the main provider.
 */
function createBenchmarkKeyProvider(
  mainProvider: KeyMaterialProvider,
): KeyMaterialProvider {
  const cache = new Map<string, ProvingKeyMaterial>();

  return {
    async lookupKey(keyLocation: string) {
      if (cache.has(keyLocation)) return cache.get(keyLocation);

      const [proverKey, verifierKey, ir] = await Promise.all([
        fetchExtension(`${BENCH_BASE}/${keyLocation}.prover`),
        fetchExtension(`${BENCH_BASE}/${keyLocation}.verifier`),
        fetchExtension(`${BENCH_BASE}/${keyLocation}.bzkir`),
      ]);

      const material: ProvingKeyMaterial = { proverKey, verifierKey, ir };
      cache.set(keyLocation, material);
      return material;
    },

    getParams(k: number) {
      return mainProvider.getParams(k);
    },
  };
}

/**
 * Runs a device benchmark by proving bundled k=10 and k=11 preimages
 * via WASM. Uses both data points for a better-calibrated doubling
 * model extrapolation across k=9 through k=20.
 *
 * @param mainProvider Provider for BLS params (keys are self-contained).
 */
export async function runBenchmark(
  mainProvider: KeyMaterialProvider,
): Promise<DeviceBenchmark> {
  const provider = createBenchmarkKeyProvider(mainProvider);
  const timings: Array<{ k: number; ms: number }> = [];

  for (const { k, path } of PREIMAGES) {
    const preimage = await fetchExtension(path);
    await provider.getParams(k);

    const t0 = Date.now();
    await prove(preimage, provider);
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
