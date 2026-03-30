import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePopupStore } from '@popup/store/popupStore';
import { ENVIRONMENT_OPTIONS, getEnvironmentLabel } from '@shared/environments';
import type { Environment, SerializedWalletState } from '@shared/types';

const LOCALNET_WALLETS = [0, 1, 2, 3];

export function Header() {
  const navigate = useNavigate();
  const status = usePopupStore((s) => s.status);
  const walletState = usePopupStore((s) => s.walletState);
  const environment = usePopupStore((s) => s.environment);
  const [wallets, setWallets] = useState<Array<{ index: number; name: string }>>([]);
  const activeWalletName = walletState?.activeWalletName ?? '';

  const currentEnv = walletState?.environment ?? environment;
  const isActive = status !== 'uninitialized';
  const isLocalnet = currentEnv === 'undeployed';

  const refreshWallets = useCallback(() => {
    if (!isActive) return;
    const port = chrome.runtime.connect({ name: 'gsd-popup' });
    port.postMessage({ type: 'GET_WALLETS', environment: currentEnv });
    port.onMessage.addListener((msg) => {
      if (msg.type === 'WALLETS_LIST') {
        setWallets(msg.wallets);
      }
      port.disconnect();
    });
  }, [currentEnv, isActive]);

  useEffect(() => {
    refreshWallets();
  }, [refreshWallets]);

  function handleNetworkSwitch(env: Environment) {
    if (env === currentEnv) return;
    const port = chrome.runtime.connect({ name: 'gsd-env-switch' });
    port.postMessage({ type: 'SWITCH_ENVIRONMENT', environment: env });
    port.onMessage.addListener((msg) => {
      if (msg.type === 'ERROR') {
        port.disconnect();
        navigate('/onboarding');
      }
    });
  }

  function handleLocalnetWallet(walletIndex: number) {
    const existing = wallets.find((w) => w.name === `Wallet ${walletIndex}`);
    if (existing && activeWalletName !== `Wallet ${walletIndex}`) {
      // Already imported with correct seed, just switch
      const port = chrome.runtime.connect({ name: 'gsd-popup' });
      port.postMessage({ type: 'SWITCH_WALLET', index: existing.index });
      port.disconnect();
    } else if (!existing) {
      // Genesis wallets use seeds 1-4 (seed 1 = master wallet with all minted NIGHT)
      const hex = (walletIndex + 1).toString(16).padStart(64, '0');
      const bytes: number[] = [];
      for (let i = 0; i < 32; i++) {
        bytes.push(parseInt(hex.slice(i * 2, i * 2 + 2), 16));
      }
      const port = chrome.runtime.connect({ name: 'gsd-popup' });
      port.postMessage({
        type: 'ADD_WALLET',
        name: `Wallet ${walletIndex}`,
        seed: bytes,
        environment: 'undeployed' as Environment,
      });
      port.onMessage.addListener((msg) => {
        if (msg.type === 'WALLET_ADDED') {
          refreshWallets();
        }
        port.disconnect();
      });
    }
  }

  function handleWalletSwitch(index: number) {
    const port = chrome.runtime.connect({ name: 'gsd-popup' });
    port.postMessage({ type: 'SWITCH_WALLET', index });
    port.disconnect();
  }

  return (
    <>
    <header className="flex items-center justify-between px-4 py-2 bg-midnight-800 border-b border-midnight-500 shrink-0">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 0C5.37275 0 0 5.37275 0 12C0 18.6273 5.37275 24 12 24C18.6273 24 24 18.6273 24 12C24 5.37275 18.6273 0 12 0ZM12 21.787C6.60346 21.787 2.21305 17.3965 2.21305 12C2.21305 6.60346 6.60276 2.21235 12 2.21235C17.3972 2.21235 21.787 6.60276 21.787 11.9993C21.787 17.3958 17.3965 21.7863 12 21.7863V21.787Z" fill="white"/>
            <path d="M13.127 10.874H10.874V13.127H13.127V10.874Z" fill="white"/>
            <path d="M13.127 7.31738H10.874V9.57031H13.127V7.31738Z" fill="white"/>
            <path d="M13.127 3.76074H10.874V6.01367H13.127V3.76074Z" fill="white"/>
          </svg>
          <h1 className="text-lg font-bold text-white tracking-wide">Midnight GSD</h1>
        </div>
        {isActive && (
          <>
            <select
              className="text-xs bg-midnight-600 text-gray-300 border border-midnight-400 rounded px-1.5 py-0.5 cursor-pointer focus:outline-none focus:border-accent-purple"
              value={currentEnv}
              onChange={(e) => handleNetworkSwitch(e.target.value as Environment)}
            >
              {ENVIRONMENT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <SyncStatusBadge walletState={walletState} />
          </>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {/* Localnet wallet picker */}
        {isActive && isLocalnet && (
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => {
                if (confirm('Clear all wallets?')) {
                  const port = chrome.runtime.connect({ name: 'gsd-popup' });
                  port.postMessage({ type: 'CLEAR_ALL' });
                  port.disconnect();
                  usePopupStore.getState().setHasVault(false);
                  usePopupStore.getState().setStatus('uninitialized');
                  usePopupStore.getState().setWalletState(null as never);
                  navigate('/onboarding');
                }
              }}
              className="text-[10px] px-1 py-0.5 rounded text-gray-500 hover:text-status-red hover:bg-midnight-600 transition-colors"
              title="Clear all wallets"
            >
              &#x2715;
            </button>
            {LOCALNET_WALLETS.map((i) => {
              const imported = wallets.some((w) => w.name === `Wallet ${i}`);
              const isCurrentWallet = activeWalletName === `Wallet ${i}`;
              return (
                <button
                  key={i}
                  onClick={() => handleLocalnetWallet(i)}
                  className={`text-[10px] px-1.5 py-0.5 rounded font-mono transition-colors ${
                    isCurrentWallet
                      ? 'bg-accent-purple text-white'
                      : imported
                        ? 'bg-midnight-600 text-gray-300 hover:bg-midnight-500'
                        : 'bg-midnight-700 text-gray-500 hover:bg-midnight-600 hover:text-gray-300'
                  }`}
                  title={imported ? `Switch to Wallet ${i}` : `Import Wallet ${i}`}
                >
                  W{i}
                </button>
              );
            })}
          </div>
        )}

        {/* Non-localnet wallet switcher */}
        {isActive && !isLocalnet && wallets.length > 1 && (
          <select
            className="text-xs bg-midnight-600 text-gray-300 border border-midnight-400 rounded px-1.5 py-0.5 cursor-pointer focus:outline-none focus:border-accent-purple"
            value={wallets.find((w) => w.name === activeWalletName)?.index ?? 0}
            onChange={(e) => handleWalletSwitch(Number(e.target.value))}
          >
            {wallets.map((w) => (
              <option key={w.index} value={w.index}>{w.name}</option>
            ))}
          </select>
        )}

        <a
          href="https://github.com/adamreynolds-io/gsd-wallet"
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded hover:bg-midnight-600 transition-colors text-gray-400 hover:text-white"
          title="GitHub — source code, docs, raise issues"
        >
          <GitHubIcon />
        </a>
        <button
          onClick={() => {
            chrome.tabs.create({ url: chrome.runtime.getURL('src/popup/index.html') });
            window.close();
          }}
          className="p-1.5 rounded hover:bg-midnight-600 transition-colors text-gray-400 hover:text-white"
          title="Open in full tab"
        >
          <ExpandIcon />
        </button>
        {isActive && (
          <button
            onClick={() => navigate('/settings')}
            className="p-1.5 rounded hover:bg-midnight-600 transition-colors text-gray-400 hover:text-white"
            title="Settings"
          >
            <SettingsIcon />
          </button>
        )}
      </div>
    </header>
    <UpdateBanner />
    </>
  );
}

function UpdateBanner() {
  const update = usePopupStore((s) => s.updateAvailable);
  if (!update) return null;

  return (
    <div className="flex items-center justify-between px-4 py-1.5 bg-amber-900/60 border-b border-amber-600/40 shrink-0">
      <span className="text-xs text-amber-200">
        Update available: <strong>v{update.latestVersion}</strong>
      </span>
      <a
        href={update.downloadUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-amber-200 underline hover:text-white"
      >
        Download
      </a>
    </div>
  );
}

function GitHubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

const PHASE_COLORS: Record<string, string> = {
  connecting: 'text-amber-400',
  'catching-up': 'text-blue-400',
  'nearly-synced': 'text-cyan-400',
  synced: 'text-green-400',
  stalled: 'text-red-400',
};

function SyncStatusBadge({ walletState }: { walletState: SerializedWalletState | null }) {
  if (!walletState) return null;
  const phase = walletState.syncPhase;
  const color = PHASE_COLORS[phase] ?? 'text-gray-400';
  const networkName = getEnvironmentLabel(walletState.environment);

  let text: string;
  switch (phase) {
    case 'connecting':
      text = `Connecting to ${networkName}...`;
      break;
    case 'catching-up':
      text = `Synchronising with ${networkName} ${walletState.overallSyncPercent}%`;
      break;
    case 'nearly-synced':
      text = `Almost synced with ${networkName}`;
      break;
    case 'stalled':
      text = `Sync with ${networkName} stalled`;
      break;
    case 'synced':
      text = `Synced with ${networkName}`;
      break;
    default:
      text = networkName;
  }

  return <span className={`text-xs ${color}`}>{text}</span>;
}

function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
