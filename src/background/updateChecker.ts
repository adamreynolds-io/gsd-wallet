import { emit } from './diagnosticLogger';

const REPO_OWNER = 'adamreynolds-io';
const REPO_NAME = 'gsd-wallet';
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const GITHUB_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
  downloadUrl: string;
  publishedAt: string;
}

let cachedUpdate: UpdateInfo | null = null;

export function getCachedUpdate(): UpdateInfo | null {
  return cachedUpdate;
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const currentVersion = chrome.runtime.getManifest().version;

  try {
    const response = await fetch(GITHUB_API, {
      headers: { 'Accept': 'application/vnd.github.v3+json' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      emit('debug', 'sw', `Update check: GitHub API returned ${response.status}`);
      return null;
    }

    const release = await response.json() as {
      tag_name: string;
      html_url: string;
      published_at: string;
      assets: Array<{ name: string; browser_download_url: string }>;
    };

    const latestVersion = release.tag_name.replace(/^v/, '');
    const updateAvailable = isNewer(latestVersion, currentVersion);
    const distAsset = release.assets.find((a) => a.name === 'dist.zip');

    cachedUpdate = {
      currentVersion,
      latestVersion,
      updateAvailable,
      releaseUrl: release.html_url,
      downloadUrl: distAsset?.browser_download_url ?? release.html_url,
      publishedAt: release.published_at,
    };

    if (updateAvailable) {
      emit('warn', 'sw', `Update available: ${currentVersion} → ${latestVersion}`, {
        currentVersion,
        latestVersion,
        releaseUrl: release.html_url,
      });
    } else {
      emit('debug', 'sw', `Up to date: ${currentVersion}`);
    }

    return cachedUpdate;
  } catch (err) {
    emit('debug', 'sw', `Update check failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function isNewer(latest: string, current: string): boolean {
  const latestParts = latest.split('.').map(Number);
  const currentParts = current.split('.').map(Number);

  for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
    const l = latestParts[i] ?? 0;
    const c = currentParts[i] ?? 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

export function startUpdateChecker(): void {
  // Check on startup (with a short delay to not block init)
  setTimeout(() => checkForUpdate(), 5_000);

  // Check periodically
  setInterval(() => checkForUpdate(), CHECK_INTERVAL_MS);
}
