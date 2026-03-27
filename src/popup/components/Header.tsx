import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePopupStore } from '@popup/store/popupStore';
import { ENVIRONMENT_OPTIONS } from '@shared/environments';
import type { Environment } from '@shared/types';

const LOCALNET_WALLETS = [0, 1, 2, 3];

export function Header() {
  const navigate = useNavigate();
  const status = usePopupStore((s) => s.status);
  const walletState = usePopupStore((s) => s.walletState);
  const environment = usePopupStore((s) => s.environment);
  const [wallets, setWallets] = useState<Array<{ index: number; name: string }>>([]);
  const activeWalletName = walletState?.activeWalletName ?? '';

  const currentEnv = walletState?.environment ?? environment;
  const isActive = status === 'synced' || status === 'syncing' || status === 'initializing';
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
    const port = chrome.runtime.connect({ name: 'gsd-popup' });
    port.postMessage({ type: 'SWITCH_ENVIRONMENT', environment: env });
    port.onMessage.addListener((msg) => {
      if (msg.type === 'ERROR') {
        navigate('/onboarding');
      }
      port.disconnect();
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
          <select
            className="text-xs bg-midnight-600 text-gray-300 border border-midnight-400 rounded px-1.5 py-0.5 cursor-pointer focus:outline-none focus:border-accent-purple"
            value={currentEnv}
            onChange={(e) => handleNetworkSwitch(e.target.value as Environment)}
          >
            {ENVIRONMENT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
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

function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}
