import { useState, useEffect, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePopupStore } from '@popup/store/popupStore';
import { ENVIRONMENT_OPTIONS, getEnvironmentLabel } from '@shared/environments';
import type { Environment } from '@shared/types';

interface WalletMenuProps {
  isOpen: boolean;
  onClose: () => void;
  currentEnv: Environment | '';
  containerRef: RefObject<HTMLDivElement | null>;
}

type WalletEntry = { index: number; name: string };
type GroupedWallets = Record<Environment, WalletEntry[]>;

const GENESIS_SEEDS = [0, 1, 2, 3];

function isGenesis(w: WalletEntry, env: string): boolean {
  return env === 'undeployed' && /^Genesis W[0-3]$/.test(w.name);
}

function displayName(w: WalletEntry, positionInEnv: number, env: string): string {
  if (isGenesis(w, env)) return w.name;
  // If the stored name already has an index (e.g. "Mainnet 2"), use it
  const envLabel = getEnvironmentLabel(env as Environment);
  if (w.name !== envLabel) return w.name;
  // Legacy wallet without index — generate at render time
  return `${envLabel} ${positionInEnv}`;
}

export function WalletMenu({
  isOpen,
  onClose,
  currentEnv,
  containerRef,
}: WalletMenuProps) {
  const navigate = useNavigate();
  const [wallets, setWallets] = useState<GroupedWallets | null>(null);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setCopiedIdx(null);
      return;
    }
    fetchWallets();
  }, [isOpen]);

  function fetchWallets() {
    const port = chrome.runtime.connect({ name: 'gsd-popup' });
    port.postMessage({ type: 'GET_ALL_WALLETS' });
    port.onMessage.addListener((msg) => {
      if (msg.type !== 'ALL_WALLETS') return;
      setWallets(msg.wallets);
      setActiveIdx(msg.activeWalletIndex);
      port.disconnect();
    });
  }

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  function switchWallet(index: number) {
    const port = chrome.runtime.connect({ name: 'gsd-popup' });
    port.postMessage({ type: 'SWITCH_WALLET', index });
    port.disconnect();
    onClose();
  }

  function deleteWallet(index: number) {
    const port = chrome.runtime.connect({ name: 'gsd-popup' });
    port.postMessage({ type: 'DELETE_WALLET', index });
    port.onMessage.addListener((msg) => {
      if (msg.type !== 'WALLET_DELETED') return;
      if (msg.success) fetchWallets();
      port.disconnect();
    });
  }

  function copySeed(index: number) {
    const port = chrome.runtime.connect({ name: 'gsd-popup' });
    port.postMessage({ type: 'GET_WALLET_SEED', index });
    port.onMessage.addListener((msg) => {
      if (msg.type !== 'WALLET_SEED') return;
      navigator.clipboard.writeText(msg.seedHex);
      setCopiedIdx(index);
      setTimeout(() => setCopiedIdx(null), 2000);
      port.disconnect();
    });
  }

  function addGenesisWallet(walletIndex: number) {
    const hex = (walletIndex + 1).toString(16).padStart(64, '0');
    const bytes: number[] = [];
    for (let i = 0; i < 32; i++) {
      bytes.push(parseInt(hex.slice(i * 2, i * 2 + 2), 16));
    }
    const port = chrome.runtime.connect({ name: 'gsd-popup' });
    port.postMessage({
      type: 'ADD_WALLET',
      name: `Genesis W${walletIndex}`,
      seed: bytes,
      environment: 'undeployed' as Environment,
    });
    port.onMessage.addListener(() => {
      port.disconnect();
      onClose();
    });
  }

  function clearUserWallets() {
    if (!confirm('Clear all user wallets? Genesis wallets will be kept.')) return;
    if (!wallets) return;
    // Delete non-genesis wallets in reverse index order to avoid shifting
    const toDelete = Object.entries(wallets).flatMap(([env, ws]) =>
      ws.filter((w) => !isGenesis(w, env)).map((w) => w.index),
    ).sort((a, b) => b - a);
    if (toDelete.length === 0) return;
    const port = chrome.runtime.connect({ name: 'gsd-popup' });
    for (const idx of toDelete) {
      port.postMessage({ type: 'DELETE_WALLET', index: idx });
    }
    port.disconnect();
    fetchWallets();
    onClose();
  }

  return (
    <div
      role="menu"
      className="absolute top-full left-0 mt-1 w-72 z-50 bg-midnight-700 border border-midnight-500 rounded-lg shadow-xl max-h-[480px] overflow-y-auto"
    >
      {/* Actions */}
      <div className="p-1.5 border-b border-midnight-500">
        <button
          role="menuitem"
          className="w-full text-left text-xs px-2.5 py-1.5 rounded text-gray-200 hover:bg-midnight-600 transition-colors"
          onClick={() => { onClose(); navigate('/onboarding'); }}
        >
          + New Wallet
        </button>
        <button
          role="menuitem"
          className="w-full text-left text-xs px-2.5 py-1.5 rounded text-gray-400 hover:bg-midnight-600 transition-colors"
          onClick={() => {
            chrome.tabs.create({ url: chrome.runtime.getURL('src/popup/index.html#/settings') });
            onClose();
          }}
        >
          Manage...
        </button>
      </div>

      {/* Grouped wallet list */}
      <div className="py-1">
        {ENVIRONMENT_OPTIONS.map((opt) => {
          const env = opt.value as Environment;
          const envWallets = wallets?.[env] ?? [];
          const isEmpty = envWallets.length === 0;
          const isUndeployed = env === 'undeployed';

          let nonGenesisIdx = 0;

          return (
            <div key={env}>
              <div className={`px-2.5 py-1 text-[10px] uppercase tracking-wider font-medium ${isEmpty && !isUndeployed ? 'text-gray-600' : 'text-gray-400'}`}>
                {opt.label}
                {envWallets.length > 0 && (
                  <span className="ml-1 text-gray-600">({envWallets.length})</span>
                )}
              </div>

              {envWallets.filter((w) => !isGenesis(w, env)).map((w) => {
                const posIdx = nonGenesisIdx++;
                const label = displayName(w, posIdx, env);
                const isActive = w.index === activeIdx && env === currentEnv;

                return (
                  <div
                    key={w.index}
                    className={`group flex items-center text-xs transition-colors ${
                      isActive
                        ? 'bg-accent-purple/15 text-white border-l-2 border-accent-purple'
                        : 'text-gray-300 hover:bg-midnight-600 border-l-2 border-transparent'
                    }`}
                  >
                    <button
                      role="menuitem"
                      onClick={() => switchWallet(w.index)}
                      className="flex-1 text-left px-2.5 py-1 truncate"
                    >
                      {label}
                    </button>
                    {isActive && (
                      <span className="text-accent-purple shrink-0 text-[10px]">&#10003;</span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); copySeed(w.index); }}
                      className={`shrink-0 px-2 py-1 text-xl transition-opacity ${
                        copiedIdx === w.index
                          ? 'text-green-400 opacity-100'
                          : 'text-gray-600 hover:text-gray-300 opacity-0 group-hover:opacity-100'
                      }`}
                      title="Copy seed hex"
                    >
                      {copiedIdx === w.index ? '\u2713' : '\u2398'}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteWallet(w.index); }}
                      className="shrink-0 px-1 py-1 text-gray-600 hover:text-status-red opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Delete wallet"
                    >
                      &#x2715;
                    </button>
                  </div>
                );
              })}

              {/* Genesis wallet quick-add buttons */}
              {isUndeployed && (
                <div className="flex gap-1 px-2.5 py-1">
                  {GENESIS_SEEDS.map((i) => {
                    const exists = envWallets.some((w) => w.name === `Genesis W${i}`);
                    const isActive = exists && envWallets.find((w) => w.name === `Genesis W${i}`)?.index === activeIdx;
                    return (
                      <button
                        key={i}
                        onClick={() => exists
                          ? switchWallet(envWallets.find((w) => w.name === `Genesis W${i}`)!.index)
                          : addGenesisWallet(i)
                        }
                        className={`text-[10px] px-1.5 py-0.5 rounded font-mono transition-colors ${
                          isActive
                            ? 'bg-accent-purple text-white'
                            : exists
                              ? 'bg-midnight-600 text-gray-300 hover:bg-midnight-500'
                              : 'bg-midnight-800 text-gray-500 hover:bg-midnight-600 hover:text-gray-300'
                        }`}
                        title={exists ? `Switch to Genesis W${i}` : `Import Genesis W${i}`}
                      >
                        W{i}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Clear all */}
      <div className="border-t border-midnight-500 p-1.5">
        <button
          role="menuitem"
          className="w-full text-left text-xs px-2.5 py-1.5 rounded text-status-red/70 hover:bg-midnight-600 hover:text-status-red transition-colors"
          onClick={clearUserWallets}
        >
          Clear User Wallets
        </button>
      </div>
    </div>
  );
}
