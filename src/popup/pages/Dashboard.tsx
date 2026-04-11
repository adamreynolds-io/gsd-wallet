import { useState, useCallback, useEffect } from 'react';
import { TransferModal } from '@popup/components/TransferModal';
import { DustModal } from '@popup/components/DustModal';
import { Inspector } from '@popup/components/Inspector';
import { DiagnosticsPanel } from '@popup/components/DiagnosticsPanel';
import { usePopupStore } from '@popup/store/popupStore';
import {
  NIGHT_TOKEN_ID,
  NIGHT_DENOMINATION,
  DUST_DENOMINATION,
} from '@shared/constants';
import type {
  SerializedWalletState,
  SerializedUtxo,
  SyncProgress,
  TxHistoryEntry,
  InspectorTarget,
} from '@shared/types';

type DebugTab = 'dust' | 'shielded' | 'unshielded' | 'txns';


function safeBigInt(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

const isFullTab = window.innerWidth > 800;

export function Dashboard() {
  const walletState = usePopupStore((s) => s.walletState);
  const [transferOpen, setTransferOpen] = useState(false);
  const [dustMode, setDustMode] = useState<
    'register' | 'deregister' | null
  >(null);
  const [debugTab, setDebugTab] = useState<DebugTab>('dust');
  const [txHistory, setTxHistory] = useState<TxHistoryEntry[]>([]);

  // Explorer panel state
  const [inspectorTarget, setInspectorTarget] =
    useState<InspectorTarget | null>(null);
  const [inspectorHistory, setInspectorHistory] =
    useState<InspectorTarget[]>([]);
  const [inspectorForward, setInspectorForward] =
    useState<InspectorTarget[]>([]);
  const [inspectorData, setInspectorData] = useState<unknown>(null);
  const [searchQuery, setSearchQuery] = useState('');

  function targetToQuery(target: InspectorTarget): string {
    switch (target.kind) {
      case 'transaction': return target.hash;
      case 'block': return String(target.height);
      case 'contract': return target.address;
    }
  }

  function inspect(target: InspectorTarget) {
    if (inspectorTarget) {
      setInspectorHistory((h) => [...h, inspectorTarget]);
    }
    setInspectorTarget(target);
    setSearchQuery(targetToQuery(target));
    setInspectorForward([]);
  }

  function inspectHash(hash: string) {
    inspect({ kind: 'transaction', hash });
  }

  function inspectorBack() {
    const prev = inspectorHistory[inspectorHistory.length - 1];
    if (prev) {
      if (inspectorTarget) {
        setInspectorForward((f) => [inspectorTarget, ...f]);
      }
      setInspectorHistory((h) => h.slice(0, -1));
      setInspectorTarget(prev);
      setSearchQuery(targetToQuery(prev));
    }
  }

  function inspectorFwd() {
    const next = inspectorForward[0];
    if (next) {
      if (inspectorTarget) {
        setInspectorHistory((h) => [...h, inspectorTarget]);
      }
      setInspectorForward((f) => f.slice(1));
      setInspectorTarget(next);
      setSearchQuery(targetToQuery(next));
    }
  }

  function inspectorClose() {
    setInspectorTarget(null);
    setInspectorHistory([]);
    setInspectorForward([]);
    setInspectorData(null);
    setSearchQuery('');
  }

  useEffect(() => {
    const port = chrome.runtime.connect({ name: 'gsd-popup' });
    port.postMessage({ type: 'GET_TX_HISTORY' });
    port.onMessage.addListener((msg) => {
      if (msg.type === 'TX_HISTORY') {
        setTxHistory(msg.entries);
        port.disconnect();
      }
    });
  }, [walletState?.status]);

  const storeEnv = usePopupStore((s) => s.environment);
  const EMPTY_PROGRESS = { applied: 0, highest: 0, highestIndex: 0, connected: false };
  const emptyState: SerializedWalletState = {
    status: 'initializing',
    environment: storeEnv,
    activeAccountIndex: 0,
    shielded: { address: '', balances: {}, coinCount: 0, syncPercent: 0, progress: EMPTY_PROGRESS },
    unshielded: { address: '', balances: {}, utxos: [], syncPercent: 0, progress: EMPTY_PROGRESS },
    dust: { address: '', balance: '0', syncPercent: 0, progress: EMPTY_PROGRESS },
    overallSyncPercent: 0,
    isSynced: false,
    syncPhase: 'connecting',
    connections: { node: false, indexer: false, prover: false },
    activeWalletName: '',
  };
  const state = walletState ?? emptyState;

  const nightBal = state.unshielded.balances[NIGHT_TOKEN_ID] ?? '0';
  const dustBal = state.dust.balance;

  const getCopyData = useCallback((): string => {
    if (inspectorTarget && inspectorData) {
      return JSON.stringify(inspectorData, null, 2);
    }
    switch (debugTab) {
      case 'dust': return JSON.stringify(state.dust, null, 2);
      case 'shielded': return JSON.stringify(state.shielded, null, 2);
      case 'unshielded': return JSON.stringify(state.unshielded, null, 2);
      case 'txns': return JSON.stringify(txHistory, null, 2);
      default: return JSON.stringify(state, null, 2);
    }
  }, [inspectorTarget, inspectorData, state, debugTab, txHistory]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Top: 2-column ── */}
      <div className={`flex gap-3 p-3 ${isFullTab ? 'min-h-[200px] max-h-[70%] shrink-0' : 'flex-1 min-h-0'}`}>

        {/* Left: wallet */}
        <div className="w-[260px] shrink-0 flex flex-col gap-1.5 min-h-0 overflow-hidden">
          <div className="bg-amber-900/60 border border-amber-600/40 text-amber-200 text-xs px-2 py-0.5 text-center rounded">
            Dev wallet — seeds unencrypted
          </div>
          {!state.isSynced && state.status !== 'initializing' && (
            <div className="bg-blue-900/60 border border-blue-600/40 text-blue-200 text-xs px-2 py-0.5 text-center rounded">
              Balances may be incomplete — sync {state.overallSyncPercent}%
            </div>
          )}

          <div className="grid grid-cols-2 gap-1.5">
            <div className="bg-midnight-600 rounded px-2 py-1">
              <div className="text-[10px] uppercase tracking-wider text-gray-500">NIGHT</div>
              <div className="text-sm font-mono text-white truncate" title={formatBigInt(nightBal, NIGHT_DENOMINATION)}>
                {formatBigInt(nightBal, NIGHT_DENOMINATION)}
              </div>
            </div>
            <div className="bg-midnight-600 rounded px-2 py-1">
              <div className="text-[10px] uppercase tracking-wider text-gray-500">DUST</div>
              <div className="text-sm font-mono text-white truncate" title={formatBigInt(dustBal, DUST_DENOMINATION)}>
                {formatLargeNumber(safeBigInt(dustBal), DUST_DENOMINATION)}
              </div>
            </div>
          </div>

          <div className="space-y-0.5">
            <AddrRow label="Shield" address={state.shielded.address} />
            <AddrRow label="Unshield" address={state.unshielded.address} />
            <AddrRow label="Dust" address={state.dust.address} />
          </div>

          <div className="flex-1" />

          <div className="flex gap-1.5 shrink-0">
            <button className="btn-primary flex-1 text-xs !py-1" onClick={() => setTransferOpen(true)} title="Send transfer">Transfer</button>
            <button className="btn-secondary flex-1 text-xs !py-1" onClick={() => setDustMode('register')} title="Register for dust">+Reg</button>
            <button className="btn-secondary flex-1 text-xs !py-1" onClick={() => setDustMode('deregister')} title="Deregister">-Dereg</button>
          </div>

          <div className="flex items-center justify-between shrink-0 text-xs">
            <div className="flex items-center gap-2">
              <StatusDot label="Node" ok={state.connections.node} />
              <StatusDot label="Idx" ok={state.connections.indexer} />
              <StatusDot label="Prv" ok={state.connections.prover} />
            </div>
            <span className="text-gray-500">
              {state.isSynced ? 'Synced' : SYNC_PHASE_LABELS[state.syncPhase] ?? `${state.overallSyncPercent}%`}
            </span>
          </div>
        </div>

        {/* Right: debug tabs */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden bg-midnight-600 rounded-lg p-3">
          <div className="flex items-center gap-1 mb-2 shrink-0">
            {(['dust', 'shielded', 'unshielded', 'txns'] as DebugTab[]).map((t) => (
              <button
                key={t}
                onClick={() => setDebugTab(t)}
                className={`text-xs px-2 py-0.5 rounded font-mono ${
                  debugTab === t
                    ? 'bg-accent-purple text-white'
                    : 'bg-midnight-800 text-gray-400 hover:text-gray-200'
                }`}
              >
                {t === 'txns'
                  ? `Txns${txHistory.length > 0 ? ` (${txHistory.length})` : ''}`
                  : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
            <div className="flex-1" />
            <CopyBtn getData={getCopyData} />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {debugTab === 'dust' && <DustDebug state={state} />}
            {debugTab === 'shielded' && <ShieldedDebug state={state} />}
            {debugTab === 'unshielded' && <UnshieldedDebug state={state} />}
            {debugTab === 'txns' && <TxHistoryTab entries={txHistory} onInspect={inspectHash} />}
          </div>
        </div>
      </div>

      {/* ── Bottom: Explorer + Diagnostics ── */}
      <div className={`border-t border-midnight-500 flex ${isFullTab ? 'flex-1 min-h-[150px]' : 'h-[280px] shrink-0'}`}>
        {/* Explorer panel */}
        <div className={`bg-midnight-900 flex flex-col ${isFullTab ? 'w-[40%] min-w-0' : 'w-[40%]'}`}>
          <div className="px-3 pt-1.5 shrink-0 space-y-1">
            <div className="flex items-center gap-1">
              <span className="text-xs uppercase tracking-wider text-gray-500">Explorer</span>
              <div className="flex-1" />
              <button
                onClick={inspectorBack}
                disabled={inspectorHistory.length === 0}
                className={`text-xs px-1.5 py-0.5 rounded bg-midnight-800 ${inspectorHistory.length > 0 ? 'text-gray-400 hover:text-gray-200' : 'text-gray-700 cursor-default'}`}
                title="Back"
              >
                &#8592;
              </button>
              <button
                onClick={inspectorFwd}
                disabled={inspectorForward.length === 0}
                className={`text-xs px-1.5 py-0.5 rounded bg-midnight-800 ${inspectorForward.length > 0 ? 'text-gray-400 hover:text-gray-200' : 'text-gray-700 cursor-default'}`}
                title="Forward"
              >
                &#8594;
              </button>
              <button
                onClick={inspectorClose}
                disabled={inspectorTarget == null}
                className={`p-0.5 rounded ${inspectorTarget != null ? 'text-gray-500 hover:text-gray-200 hover:bg-midnight-800' : 'text-gray-700 cursor-default'}`}
                title="Clear explorer"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
              <CopyBtn getData={() => inspectorData ? JSON.stringify(inspectorData, null, 2) : ''} disabled={inspectorData == null} />
            </div>
            <ExplorerSearch
              value={searchQuery}
              onChange={setSearchQuery}
              onSearch={(target) => {
                setInspectorHistory([]);
                setInspectorForward([]);
                setInspectorData(null);
                setInspectorTarget(target);
                setSearchQuery(targetToQuery(target));
              }}
            />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2">
            {inspectorTarget ? (
              <Inspector
                key={targetToQuery(inspectorTarget)}
                target={inspectorTarget}
                environment={state.environment}
                onInspect={inspect}
                onClose={inspectorClose}
                onBack={inspectorHistory.length > 0 ? inspectorBack : undefined}
                onDataLoaded={setInspectorData}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-600 text-sm">
                Click a transaction hash, UTXO, or address to inspect
              </div>
            )}
          </div>
        </div>

        {/* Diagnostics panel */}
        <div className="w-[60%] min-w-0 border-l border-midnight-500">
          <DiagnosticsPanel onInspect={inspect} />
        </div>
      </div>

      {/* Status bar */}
      <SyncStatusBar state={state} />

      {/* Modals */}
      <TransferModal open={transferOpen} onClose={() => setTransferOpen(false)} />
      {dustMode && <DustModal open={true} onClose={() => setDustMode(null)} mode={dustMode} />}
    </div>
  );
}

/* ── Address row ── */

function AddrRow({ label, address }: {
  label: string;
  address: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [address]);

  const short = address.length > 28
    ? `${address.slice(0, 12)}...${address.slice(-8)}`
    : address || '...';

  return (
    <div className="flex items-center gap-1.5 text-sm bg-white/5 rounded px-2 py-1">
      <span className="text-gray-500 w-14 shrink-0">{label}</span>
      <span className="font-mono text-gray-300 truncate flex-1" title={address}>
        {short}
      </span>
      <button onClick={copy} className="text-gray-400 hover:text-white shrink-0" title="Copy">
        {copied ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4caf50" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
        )}
      </button>
    </div>
  );
}

/* ── Debug tabs ── */

function SyncStatusBar({ state }: { state: SerializedWalletState }) {
  const totalApplied = state.shielded.progress.applied + state.unshielded.progress.applied + state.dust.progress.applied;
  const totalHighest = state.shielded.progress.highest + state.unshielded.progress.highest + state.dust.progress.highest;
  const allConnected = state.shielded.progress.connected && state.unshielded.progress.connected && state.dust.progress.connected;
  const percent = totalHighest > 0 ? Math.floor((totalApplied / totalHighest) * 100) : 0;
  const update = usePopupStore((s) => s.updateAvailable);
  const currentVersion = chrome.runtime.getManifest().version;
  return (
    <div className="shrink-0 flex items-center gap-3 px-3 py-0.5 bg-midnight-900 border-t border-midnight-600 text-xs whitespace-nowrap overflow-x-auto">
      <span className={`shrink-0 ${allConnected ? 'text-green-400' : 'text-red-400'}`}>
        {allConnected ? 'Connected' : 'Disconnected'}
      </span>
      <span className="text-gray-500 font-mono shrink-0">
        {totalApplied.toLocaleString()} / {totalHighest.toLocaleString()} ({percent}%)
      </span>
      <span className="text-midnight-600">|</span>
      <SyncDetailRow label="Shielded" color="text-fuchsia-400" progress={state.shielded.progress} percent={state.shielded.syncPercent} />
      <SyncDetailRow label="Unshielded" color="text-blue-400" progress={state.unshielded.progress} percent={state.unshielded.syncPercent} />
      <SyncDetailRow label="Dust" color="text-amber-400" progress={state.dust.progress} percent={state.dust.syncPercent} />
      <span className="text-midnight-600">|</span>
      {update ? (
        <a
          href={update.releaseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-amber-400 hover:text-amber-300 transition-colors"
          title={`Update available: v${update.latestVersion}`}
        >
          v{currentVersion} → v{update.latestVersion}
        </a>
      ) : (
        <span className="shrink-0 text-white">v{currentVersion}</span>
      )}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{k}</span>
      <span className="text-gray-200 font-mono">{v}</span>
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return <div className="text-xs uppercase tracking-wider text-gray-500 pt-0.5">{label}</div>;
}

function DustDebug({ state }: {
  state: SerializedWalletState;
}) {
  return (
    <div className="space-y-1">
      <KV k="Balance" v={formatLargeNumber(safeBigInt(state.dust.balance), DUST_DENOMINATION)} />
      <KV k="Address" v={trunc(state.dust.address)} />
      <Divider label={`UTXOs (${state.unshielded.utxos.length})`} />
      <UtxoList utxos={state.unshielded.utxos} />
    </div>
  );
}

function ShieldedDebug({ state }: { state: SerializedWalletState }) {
  const entries = Object.entries(state.shielded.balances);
  return (
    <div className="space-y-1">
      <KV k="Coins" v={String(state.shielded.coinCount)} />
      <Divider label="Balances" />
      {entries.length === 0 ? (
        <div className="text-sm text-gray-500">None</div>
      ) : entries.map(([id, amt]) => (
        <KV key={id}
          k={id === NIGHT_TOKEN_ID ? 'NIGHT' : `${id.slice(0, 10)}...`}
          v={id === NIGHT_TOKEN_ID ? formatLargeNumber(safeBigInt(amt), NIGHT_DENOMINATION) : amt}
        />
      ))}
    </div>
  );
}

function UnshieldedDebug({ state }: {
  state: SerializedWalletState;
}) {
  const entries = Object.entries(state.unshielded.balances);
  const reg = state.unshielded.utxos.filter((u) => u.registered);
  const unreg = state.unshielded.utxos.filter((u) => !u.registered);
  return (
    <div className="space-y-1">
      <KV k="UTXOs" v={String(state.unshielded.utxos.length)} />
      <KV k="Registered" v={`${reg.length} / ${state.unshielded.utxos.length}`} />
      <KV k="Unregistered" v={String(unreg.length)} />
      <Divider label="Balances" />
      {entries.length === 0 ? (
        <div className="text-sm text-gray-500">None</div>
      ) : entries.map(([id, amt]) => (
        <KV key={id}
          k={id === NIGHT_TOKEN_ID ? 'NIGHT' : `${id.slice(0, 10)}...`}
          v={id === NIGHT_TOKEN_ID ? formatLargeNumber(safeBigInt(amt), NIGHT_DENOMINATION) : amt}
        />
      ))}
      <Divider label={`UTXOs (${state.unshielded.utxos.length})`} />
      <UtxoList utxos={state.unshielded.utxos} />
    </div>
  );
}

function TxHistoryTab({ entries, onInspect }: {
  entries: TxHistoryEntry[];
  onInspect: (hash: string) => void;
}) {
  if (entries.length === 0) {
    return <div className="text-sm text-gray-500 py-4 text-center">No transactions yet</div>;
  }
  return (
    <div className="space-y-1">
      {entries.map((tx) => (
        <div key={tx.txHash} className="bg-midnight-800 rounded px-2 py-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-300">{TX_TYPE_LABELS[tx.type] ?? tx.type}</span>
            <span className={TX_STATUS_COLORS[tx.status] ?? 'text-gray-400'}>{tx.status}</span>
          </div>
          <div className="flex items-center justify-between text-xs mt-0.5">
            <button onClick={() => onInspect(tx.txHash)}
              className="font-mono text-accent-purple hover:underline truncate mr-2 text-left" title="Inspect">
              {tx.txHash.slice(0, 16)}...{tx.txHash.slice(-8)}
            </button>
            <span className="text-gray-500 shrink-0">{formatTime(tx.timestamp)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function UtxoList({ utxos }: {
  utxos: SerializedUtxo[];
}) {
  if (utxos.length === 0) {
    return <div className="text-sm text-gray-500">No UTXOs</div>;
  }
  return (
    <div className="space-y-0.5">
      {utxos.map((utxo) => (
          <div key={utxo.id} className="flex items-center justify-between text-xs px-1.5 py-0.5 bg-midnight-800 rounded">
            <span className="font-mono text-gray-400 truncate mr-2" title={utxo.id}>
              {utxo.id.slice(0, 24)}...
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="font-mono text-white">
                {formatLargeNumber(safeBigInt(utxo.value), NIGHT_DENOMINATION)}
              </span>
              <span className={`text-xs px-1 rounded ${utxo.registered ? 'bg-green-900/40 text-green-400' : 'bg-gray-700 text-gray-500'}`}
                title={utxo.registered ? 'Registered for dust generation' : 'Not registered'}>
                {utxo.registered ? 'REG' : 'UNREG'}
              </span>
            </div>
          </div>
      ))}
    </div>
  );
}

/* ── Shared ── */

const SYNC_PHASE_LABELS: Record<string, string> = {
  connecting: 'Connecting...',
  'catching-up': 'Syncing...',
  'nearly-synced': 'Almost synced',
  synced: 'Synced',
  stalled: 'Stalled',
};

const TX_TYPE_LABELS: Record<string, string> = {
  transfer: 'Transfer', dustReg: 'Dust Reg', dustDereg: 'Dust Dereg', dappTx: 'DApp Tx',
};
const TX_STATUS_COLORS: Record<string, string> = {
  pending: 'text-amber-400', confirmed: 'text-green-400', finalized: 'text-green-300', discarded: 'text-red-400',
};

function CopyBtn({ getData, disabled }: { getData: () => string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { if (!disabled) { navigator.clipboard.writeText(getData()); setCopied(true); setTimeout(() => setCopied(false), 1500); } }}
      disabled={disabled}
      className={`p-0.5 rounded ${disabled ? 'text-gray-700 cursor-default' : 'text-gray-500 hover:text-gray-200 hover:bg-midnight-800'}`}
      title="Copy current view as JSON to clipboard"
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4caf50" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
      )}
    </button>
  );
}

function trunc(s: string, len = 24): string {
  if (s.length <= len) return s;
  return `${s.slice(0, 12)}...${s.slice(-8)}`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

function formatBigInt(value: string, denomination: bigint): string {
  const num = BigInt(value);
  const whole = num / denomination;
  const frac = num % denomination;
  if (frac === 0n) return whole.toLocaleString('en-US');
  const fracStr = frac.toString().padStart(denomination.toString().length - 1, '0').replace(/0+$/, '');
  return `${whole.toLocaleString('en-US')}.${fracStr}`;
}

function formatLargeNumber(value: bigint, denomination: bigint): string {
  const whole = value / denomination;
  const frac = value % denomination;
  if (frac === 0n) return fmtSuffix(whole);
  const fracStr = frac.toString().padStart(denomination.toString().length - 1, '0').replace(/0+$/, '').slice(0, 4);
  return `${fmtSuffix(whole)}.${fracStr}`;
}

function fmtSuffix(n: bigint): string {
  if (n >= 1_000_000_000_000n) return `${(Number(n) / 1e12).toFixed(2)}T`;
  if (n >= 1_000_000_000n) return `${(Number(n) / 1e9).toFixed(2)}B`;
  if (n >= 1_000_000n) return `${(Number(n) / 1e6).toFixed(2)}M`;
  return n.toLocaleString('en-US');
}

function StatusDot({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className="flex items-center gap-0.5 cursor-default" title={`${label}: ${ok ? 'Connected' : 'Disconnected'}`}>
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${ok ? 'bg-green-400 shadow-[0_0_4px_rgba(76,175,80,0.6)]' : 'bg-red-400 shadow-[0_0_4px_rgba(244,67,54,0.6)]'}`} />
      <span className="text-gray-500">{label}</span>
    </span>
  );
}

function ExplorerSearch({ value, onChange, onSearch }: {
  value: string;
  onChange: (v: string) => void;
  onSearch: (target: InspectorTarget) => void;
}) {
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = value.trim();
    if (!q) return;

    if (/^\d+$/.test(q)) {
      onSearch({ kind: 'block', height: Number(q) });
    } else {
      onSearch({ kind: 'transaction', hash: q });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-1">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="tx hash, block height, or contract"
        spellCheck={false}
        autoComplete="off"
        className="text-xs bg-midnight-900 border border-midnight-600 rounded px-2 py-1 text-gray-300 placeholder-gray-600 flex-1 min-w-0 focus:border-accent-purple focus:outline-none"
      />
      <button
        type="submit"
        className="text-xs px-2 py-1 rounded bg-midnight-800 text-gray-400 hover:text-gray-200"
        title="Search"
      >
        Go
      </button>
    </form>
  );
}

function abbreviateCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function SyncDetailRow({ label, color, progress, percent }: {
  label: string;
  color: string;
  progress: SyncProgress;
  percent: number;
}) {
  return (
    <div
      className="flex-1 flex items-center justify-between text-xs"
      title={`${label}: ${progress.applied.toLocaleString()} / ${progress.highest.toLocaleString()}`}
    >
      <span className={`shrink-0 ${color}`}>{label}</span>
      <span className="text-gray-500 font-mono">
        {abbreviateCount(progress.applied)} / {abbreviateCount(progress.highest)}
      </span>
    </div>
  );
}