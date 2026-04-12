import type { KeyMaterialProvider, ProvingKeyMaterial } from '@midnight-ntwrk/zkir-v2';
import {
  getProvingKey,
  saveProvingKey,
  getProvingParams,
  saveProvingParams,
} from '@shared/storage';
import type { DiagnosticCategory, DiagnosticLevel } from '@shared/types';

const S3_BASE = 'https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com';
const KEY_VERSION = 9;
const MAX_BUNDLED_K = 16;

/** Minimal subset of emit signature used here. */
export type EmitFn = (
  level: DiagnosticLevel,
  category: DiagnosticCategory,
  message: string,
  data?: unknown,
  elapsed?: number,
) => void;

const KEY_LOCATION_MAP: Record<string, string> = {
  'midnight/zswap/spend': `zswap/${KEY_VERSION}/spend`,
  'midnight/zswap/output': `zswap/${KEY_VERSION}/output`,
  'midnight/zswap/sign': `zswap/${KEY_VERSION}/sign`,
  'midnight/dust/spend': `dust/${KEY_VERSION}/spend`,
};

async function fetchWithRetry(url: string, retries = 5): Promise<ArrayBuffer> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      return response.arrayBuffer();
    } catch (err) {
      lastErr = err;
      if (attempt < retries - 1) {
        const delay = 2000 * Math.pow(2, attempt);
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw new Error(`Failed to fetch ${url} after ${retries} attempts: ${String(lastErr)}`);
}

async function fetchBundled(path: string): Promise<ArrayBuffer | null> {
  try {
    const url = chrome.runtime.getURL(`data/proving/${path}`);
    const response = await fetch(url);
    if (!response.ok) return null;
    return response.arrayBuffer();
  } catch {
    return null;
  }
}

/**
 * Creates a KeyMaterialProvider with three-tier cache:
 * in-memory Map -> IndexedDB -> bundled file / S3 fallback.
 *
 * @param emit Diagnostic logger function for proving-category events.
 */
export function createKeyMaterialProvider(emit: EmitFn): KeyMaterialProvider {
  const memCache = new Map<string, ProvingKeyMaterial | Uint8Array>();

  async function lookupKey(keyLocation: string): Promise<ProvingKeyMaterial | undefined> {
    const path = KEY_LOCATION_MAP[keyLocation];
    if (path === undefined) {
      emit('warn', 'proving', `Unknown key location: ${keyLocation}`);
      return undefined;
    }

    const cached = memCache.get(path);
    if (cached !== undefined) {
      return cached as ProvingKeyMaterial;
    }

    const dbEntry = await getProvingKey(path);
    if (dbEntry) {
      const material: ProvingKeyMaterial = {
        proverKey: dbEntry.proverKey,
        verifierKey: dbEntry.verifierKey,
        ir: dbEntry.ir,
      };
      memCache.set(path, material);
      return material;
    }

    emit('info', 'proving', `Loading key material: ${path}`);
    const t0 = Date.now();

    const [proverBuf, verifierBuf, irBuf] = await Promise.all([
      fetchBundled(`${path}.prover`).then((b) => b ?? fetchWithRetry(`${S3_BASE}/${path}.prover`)),
      fetchBundled(`${path}.verifier`).then((b) => b ?? fetchWithRetry(`${S3_BASE}/${path}.verifier`)),
      fetchBundled(`${path}.bzkir`).then((b) => b ?? fetchWithRetry(`${S3_BASE}/${path}.bzkir`)),
    ]);

    const material: ProvingKeyMaterial = {
      proverKey: new Uint8Array(proverBuf),
      verifierKey: new Uint8Array(verifierBuf),
      ir: new Uint8Array(irBuf),
    };

    await saveProvingKey({
      location: path,
      proverKey: material.proverKey,
      verifierKey: material.verifierKey,
      ir: material.ir,
    });
    memCache.set(path, material);

    emit('info', 'proving', `Key material loaded: ${path}`, undefined, Date.now() - t0);
    return material;
  }

  async function getParams(k: number): Promise<Uint8Array> {
    if (!Number.isInteger(k) || k < 1 || k > 64) {
      throw new Error(`Invalid k value: ${k}`);
    }
    const cacheKey = `params-${k}`;

    const cached = memCache.get(cacheKey);
    if (cached !== undefined) {
      return cached as Uint8Array;
    }

    const dbEntry = await getProvingParams(k);
    if (dbEntry) {
      memCache.set(cacheKey, dbEntry.data);
      return dbEntry.data;
    }

    emit('info', 'proving', `Loading BLS params: k=${k}`);
    const t0 = Date.now();

    let buf: ArrayBuffer | null = null;
    if (k <= MAX_BUNDLED_K) {
      buf = await fetchBundled(`bls_midnight_2p${k}`);
    }
    if (buf === null) {
      buf = await fetchWithRetry(`${S3_BASE}/bls_midnight_2p${k}`);
    }

    const data = new Uint8Array(buf);
    await saveProvingParams({ k, data });
    memCache.set(cacheKey, data);

    emit('info', 'proving', `BLS params loaded: k=${k}`, undefined, Date.now() - t0);
    return data;
  }

  return { lookupKey, getParams };
}
