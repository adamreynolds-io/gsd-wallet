import { putNetworkEvents, getNetworkEvents } from '@shared/storage';
import { emit } from './diagnosticLogger';

const BATCH_SIZE = 500;

/** Known remote cache URLs per network. */
const REMOTE_CACHE_URLS: Partial<Record<string, string>> = {
  // Example: 'mainnet': 'https://cdn.example.com/cache/mainnet-cache.ndjson',
};

/**
 * Parses NDJSON text and batch-writes events to IndexedDB.
 *
 * Each line: `{"id":1,"raw":"0a1b2c...","maxId":88302,"t":"zswap"}`
 */
async function importNdjson(network: string, text: string): Promise<number> {
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) return 0;

  let imported = 0;
  let zswapBatch: Array<{ id: number; raw: string; maxId: number }> = [];
  let dustBatch: Array<{ id: number; raw: string; maxId: number }> = [];

  for (const line of lines) {
    const event = JSON.parse(line) as { id: number; raw: string; maxId: number; t: string };
    const batch = event.t === 'zswap' ? zswapBatch : dustBatch;
    batch.push({ id: event.id, raw: event.raw, maxId: event.maxId });

    if (zswapBatch.length >= BATCH_SIZE) {
      await putNetworkEvents(network, 'zswap', zswapBatch);
      imported += zswapBatch.length;
      zswapBatch = [];
    }
    if (dustBatch.length >= BATCH_SIZE) {
      await putNetworkEvents(network, 'dust', dustBatch);
      imported += dustBatch.length;
      dustBatch = [];
    }
  }

  if (zswapBatch.length > 0) {
    await putNetworkEvents(network, 'zswap', zswapBatch);
    imported += zswapBatch.length;
  }
  if (dustBatch.length > 0) {
    await putNetworkEvents(network, 'dust', dustBatch);
    imported += dustBatch.length;
  }

  return imported;
}

/**
 * Imports a cache snapshot into IndexedDB for a given network.
 *
 * Tries sources in order:
 * 1. Bundled file: `data/{network}-cache.ndjson` (shipped with the extension)
 * 2. Remote URL: configured per-network in `REMOTE_CACHE_URLS`
 *
 * The NDJSON format has one JSON object per line:
 * `{"id":1,"raw":"0a1b2c...","maxId":88302,"t":"zswap"}`
 *
 * Runs once per network on first wallet startup when the cache is empty.
 */
export async function importBundledCache(network: string): Promise<boolean> {
  const t0 = Date.now();

  // Try bundled file first
  // chrome.runtime.getURL may not be available in Web Workers — fall back to
  // constructing the URL from the worker's own location.
  try {
    let bundledUrl: string;
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      bundledUrl = chrome.runtime.getURL(`data/${network}-cache.ndjson`);
    } else {
      // Worker context: derive extension root from import.meta.url or self.location
      const workerUrl = (self as unknown as { location: { href: string } }).location.href;
      const extensionRoot = workerUrl.substring(0, workerUrl.indexOf('/assets/'));
      bundledUrl = `${extensionRoot}/data/${network}-cache.ndjson`;
    }
    emit('debug', 'storage', `Fetching bundled cache from ${bundledUrl}`);
    const response = await fetch(bundledUrl);
    if (response.ok) {
      const text = await response.text();
      const count = await importNdjson(network, text);
      if (count > 0) {
        emit('info', 'storage', `Imported bundled cache: ${count} events`, {
          network,
          source: 'bundled',
          elapsed: Date.now() - t0,
        });
        return true;
      }
    }
  } catch (err) {
    emit('debug', 'storage', `Bundled cache fetch failed`, { error: String(err) });
    // Bundled file not available — try remote
  }

  // Try remote URL
  const remoteUrl = REMOTE_CACHE_URLS[network];
  if (remoteUrl) {
    try {
      emit('info', 'storage', `Fetching remote cache for ${network}`, { url: remoteUrl });
      const response = await fetch(remoteUrl);
      if (response.ok) {
        const text = await response.text();
        const count = await importNdjson(network, text);
        if (count > 0) {
          emit('info', 'storage', `Imported remote cache: ${count} events`, {
            network,
            source: 'remote',
            elapsed: Date.now() - t0,
          });
          return true;
        }
      }
    } catch (err) {
      emit('warn', 'storage', `Remote cache fetch failed`, {
        network,
        url: remoteUrl,
        error: String(err),
      });
    }
  }

  emit('debug', 'storage', `No cache snapshot available for ${network}`);
  return false;
}

/**
 * Exports the network event cache as an NDJSON string.
 *
 * Each line: `{"id":1,"raw":"0a1b2c...","maxId":88302,"t":"zswap"}`
 *
 * Both zswap and dust events are included, sorted by id.
 */
export async function exportCacheAsNdjson(network: string): Promise<string> {
  const [zswapEvents, dustEvents] = await Promise.all([
    getNetworkEvents(network, 'zswap'),
    getNetworkEvents(network, 'dust'),
  ]);

  const all = [
    ...zswapEvents.map((e) => ({ id: e.id, raw: e.raw, maxId: e.maxId, t: 'zswap' as const })),
    ...dustEvents.map((e) => ({ id: e.id, raw: e.raw, maxId: e.maxId, t: 'dust' as const })),
  ].sort((a, b) => a.id - b.id);

  emit('info', 'storage', `Exporting cache: ${all.length} events`, {
    network,
    zswap: zswapEvents.length,
    dust: dustEvents.length,
  });

  return all.map((e) => JSON.stringify(e)).join('\n');
}
