import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePopupStore } from '@popup/store/popupStore';
import { getEnvironmentLabel } from '@shared/environments';
import type { DeviceBenchmark, ProvingStrategy, SerializedWalletState, SocketState } from '@shared/types';
import { WalletMenu } from './WalletMenu';
import { useSocketToggle } from '@popup/hooks/useSocketToggle';

export function Header() {
  const navigate = useNavigate();
  const status = usePopupStore((s) => s.status);
  const walletState = usePopupStore((s) => s.walletState);
  const environment = usePopupStore((s) => s.environment);
  const socketState = usePopupStore((s) => s.socketState);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement>(null);

  const currentEnv = walletState?.environment ?? environment;
  const isActive = status !== 'uninitialized';

  const rawName = walletState?.activeWalletName ?? '';
  const headerLabel = rawName || (currentEnv ? getEnvironmentLabel(currentEnv) : 'No Wallet');

  return (
    <>
    <header className="flex items-center justify-between px-4 py-2 bg-midnight-800 border-b border-midnight-500 shrink-0">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-bold text-white tracking-wide">Midnight G.S.D. Wallet</h1>
        {isActive && (
          <>
            <div className="relative" ref={menuContainerRef}>
              <button
                onClick={() => setMenuOpen((prev) => !prev)}
                aria-expanded={menuOpen}
                aria-haspopup="true"
                className="flex items-center gap-1.5 text-xs bg-midnight-600 text-gray-300 border border-midnight-400 rounded px-2 py-1 hover:bg-midnight-500 hover:border-midnight-300 transition-colors cursor-pointer"
              >
                <span className="font-medium text-white truncate max-w-[140px]">
                  {headerLabel}
                </span>
                <ChevronDownIcon />
              </button>
              <WalletMenu
                isOpen={menuOpen}
                onClose={() => setMenuOpen(false)}
                currentEnv={currentEnv}
                containerRef={menuContainerRef}
              />
            </div>
            <SyncStatusBadge walletState={walletState} />
          </>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <SocketToggle socketState={socketState} />
        {isActive && <ProvingStrategySelector />}
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

function ChevronDownIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function SocketToggle({ socketState }: { socketState: SocketState }) {
  const { toggle } = useSocketToggle();

  const colorClass =
    socketState === 'active' ? 'text-lime-400 hover:bg-midnight-600' :
    socketState === 'waiting' ? 'text-amber-400 animate-pulse' :
    'text-gray-500 hover:bg-midnight-600 hover:text-gray-300';

  const title =
    socketState === 'active' ? 'Session active — click to end session' :
    socketState === 'waiting' ? 'Waiting for connection — click to disable' :
    'Socket off — click to enable';

  return (
    <button
      onClick={() => toggle()}
      className={`p-1.5 rounded transition-colors ${colorClass}`}
      title={title}
    >
      <SocketIcon />
    </button>
  );
}

function SocketIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22v-4" />
      <path d="M7 12V6a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v6" />
      <path d="M9 2v3" />
      <path d="M15 2v3" />
      <rect x="5" y="12" width="14" height="4" rx="1" />
    </svg>
  );
}

const K_OPTIONS = [0, 17, 16, 15, 14, 13, 12, 11, 10, 9];

function formatEstimatedTime(ms: number): string {
  if (ms < 1000) return '<1s';
  if (ms < 60_000) return `~${Math.round(ms / 1000)}s`;
  return `~${Math.round(ms / 60_000)}m`;
}

function strategyLabel(kThreshold: number): string {
  if (kThreshold === 0) return 'Server';
  return `WASM \u2264${kThreshold}`;
}

function optionLabel(kThreshold: number, benchmark: DeviceBenchmark | null): string {
  if (kThreshold === 0) return 'Server only';
  const base = `WASM \u2264${kThreshold}`;
  if (!benchmark) return base;
  const est = benchmark.estimates[kThreshold];
  return est !== undefined ? `${base}  ${formatEstimatedTime(est)}` : base;
}

function sendStrategyMessage(strategy: ProvingStrategy, onUpdate: (s: ProvingStrategy) => void): void {
  const port = chrome.runtime.connect({ name: 'gsd-popup' });
  const timeout = setTimeout(() => port.disconnect(), 5000);
  port.onMessage.addListener((msg: { type: string; strategy?: ProvingStrategy }) => {
    if (msg.type === 'PROVING_STRATEGY' && msg.strategy) {
      clearTimeout(timeout);
      onUpdate(msg.strategy);
      port.disconnect();
    } else if (msg.type === 'ERROR') {
      clearTimeout(timeout);
      port.disconnect();
    }
  });
  port.postMessage({ type: 'SET_PROVING_STRATEGY', strategy });
}

function ProvingStrategySelector() {
  const provingStrategy = usePopupStore((s) => s.provingStrategy);
  const provingStatus = usePopupStore((s) => s.provingStatus);
  const deviceBenchmark = usePopupStore((s) => s.deviceBenchmark);
  const setProvingStrategy = usePopupStore((s) => s.setProvingStrategy);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const isProving = provingStatus !== null &&
    provingStatus.phase !== 'idle' &&
    provingStatus.phase !== 'done' &&
    provingStatus.phase !== 'error' &&
    provingStatus.phase !== 'cancelled';

  const buttonLabel = strategyLabel(provingStrategy.kThreshold);

  function handleSelect(kThreshold: number) {
    setOpen(false);
    sendStrategyMessage({ kThreshold }, setProvingStrategy);
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-colors
          hover:bg-midnight-600
          ${isProving ? 'text-fuchsia-400 animate-pulse' : 'text-gray-400 hover:text-white'}`}
        title="Proving strategy — select WASM vs server threshold"
      >
        <ChipIcon />
        <span className="font-mono">{buttonLabel}</span>
      </button>
      {open && (
        <div role="listbox" className="absolute right-0 top-full mt-1 bg-midnight-700 border border-midnight-500 rounded shadow-lg z-50 min-w-[180px]">
          {K_OPTIONS.map((k) => {
            const selected = provingStrategy.kThreshold === k;
            return (
              <button
                key={k}
                role="option"
                aria-selected={selected}
                onClick={() => handleSelect(k)}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between gap-2 transition-colors
                  hover:bg-midnight-600
                  ${selected ? 'text-white' : 'text-gray-300'}`}
              >
                <span className="font-mono">{optionLabel(k, deviceBenchmark)}</span>
                {selected && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChipIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="7" y="7" width="10" height="10" rx="1" />
      <path d="M7 9H4M7 12H4M7 15H4M17 9h3M17 12h3M17 15h3M9 7V4M12 7V4M15 7V4M9 17v3M12 17v3M15 17v3" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
