import { useState, useCallback, useEffect } from 'react';
import { TransferModal } from '@popup/components/TransferModal';
import { DustModal } from '@popup/components/DustModal';
import { Inspector } from '@popup/components/Inspector';
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
  const [inspectorData, setInspectorData] = useState<unknown>(null);

  function inspect(target: InspectorTarget) {
    if (inspectorTarget) {
      setInspectorHistory((h) => [...h, inspectorTarget]);
    }
    setInspectorTarget(target);
  }

  function inspectHash(hash: string) {
    inspect({ kind: 'transaction', hash });
  }

  function inspectorBack() {
    const prev = inspectorHistory[inspectorHistory.length - 1];
    if (prev) {
      setInspectorHistory((h) => h.slice(0, -1));
      setInspectorTarget(prev);
    }
  }

  function inspectorClose() {
    setInspectorTarget(null);
    setInspectorHistory([]);
    setInspectorData(null);
  }

  useEffect(() => {
    const port = chrome.runtime.connect({ name: 'gsd-popup' });
    port.postMessage({ type: 'GET_TX_HISTORY' });
    port.onMessage.addListener((msg) => {
      if (msg.type === 'TX_HISTORY') {
        setTxHistory(msg.entries);
      }
      port.disconnect();
    });
  }, [walletState?.status]);

  if (!walletState) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <Spinner /> Connecting to wallet...
      </div>
    );
  }

  const nightBal =
    walletState.unshielded.balances[NIGHT_TOKEN_ID] ?? '0';
  const dustBal = walletState.dust.balance;

  const getCopyData = useCallback((): string => {
    if (inspectorTarget && inspectorData) {
      return JSON.stringify(inspectorData, null, 2);
    }
    if (!walletState) return '{}';
    switch (debugTab) {
      case 'dust': return JSON.stringify(walletState.dust, null, 2);
      case 'shielded': return JSON.stringify(walletState.shielded, null, 2);
      case 'unshielded': return JSON.stringify(walletState.unshielded, null, 2);
      case 'txns': return JSON.stringify(txHistory, null, 2);
      default: return JSON.stringify(walletState, null, 2);
    }
  }, [inspectorTarget, inspectorData, walletState, debugTab, txHistory]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Top: 2-column ── */}
      <div className="flex-1 min-h-0 grid grid-cols-[260px_1fr] gap-3 p-3">

        {/* Left: wallet */}
        <div className="flex flex-col gap-1.5 min-h-0">
          <div className="bg-amber-900/60 border border-amber-600/40 text-amber-200 text-[10px] px-2 py-0.5 text-center rounded">
            Dev wallet — seeds unencrypted
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <div className="bg-midnight-600 rounded px-2.5 py-2">
              <div className="text-[8px] uppercase tracking-wider text-gray-500">NIGHT</div>
              <div className="text-base font-mono text-white truncate" title={formatBigInt(nightBal, NIGHT_DENOMINATION)}>
                {formatBigInt(nightBal, NIGHT_DENOMINATION)}
              </div>
            </div>
            <div className="bg-midnight-600 rounded px-2.5 py-2">
              <div className="text-[8px] uppercase tracking-wider text-gray-500">DUST</div>
              <div className="text-base font-mono text-white truncate" title={formatBigInt(dustBal, DUST_DENOMINATION)}>
                {formatLargeNumber(BigInt(dustBal), DUST_DENOMINATION)}
              </div>
            </div>
          </div>

          {!walletState.isSynced && (
            <div className="flex items-center gap-1.5">
              <div className="flex-1 h-1 bg-midnight-900 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-accent-purple to-accent-magenta rounded-full transition-[width] duration-300"
                  style={{ width: `${walletState.overallSyncPercent}%` }} />
              </div>
              <span className="text-[9px] text-gray-500">{walletState.overallSyncPercent}%</span>
            </div>
          )}

          <div className="space-y-0.5">
            <AddrRow label="Shield" address={walletState.shielded.address} />
            <AddrRow label="Unshield" address={walletState.unshielded.address} />
            <AddrRow label="Dust" address={walletState.dust.address} />
          </div>

          <div className="flex-1" />

          <div className="flex gap-1.5 shrink-0">
            <button className="btn-primary flex-1 text-xs !py-1.5" onClick={() => setTransferOpen(true)} title="Send transfer">Transfer</button>
            <button className="btn-secondary flex-1 text-xs !py-1.5" onClick={() => setDustMode('register')} title="Register for dust">+Reg</button>
            <button className="btn-secondary flex-1 text-xs !py-1.5" onClick={() => setDustMode('deregister')} title="Deregister">-Dereg</button>
          </div>

          <div className="flex items-center justify-between shrink-0 text-[9px] pt-1 border-t border-midnight-500">
            <div className="flex items-center gap-2">
              <StatusDot label="Node" ok={walletState.connections.node} />
              <StatusDot label="Idx" ok={walletState.connections.indexer} />
              <StatusDot label="Prv" ok={walletState.connections.prover} />
            </div>
            <span className="text-gray-500">
              {walletState.isSynced ? 'Synced' : `${walletState.overallSyncPercent}%`}
            </span>
          </div>
        </div>

        {/* Right: debug tabs */}
        <div className="flex flex-col min-h-0 bg-midnight-600 rounded-lg p-3">
          <div className="flex items-center gap-1 mb-2 shrink-0">
            {(['dust', 'shielded', 'unshielded', 'txns'] as DebugTab[]).map((t) => (
              <button
                key={t}
                onClick={() => setDebugTab(t)}
                className={`text-[10px] px-2 py-0.5 rounded font-mono ${
                  debugTab === t
                    ? 'bg-accent-purple text-white'
                    : 'bg-midnight-700 text-gray-400 hover:text-gray-200'
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
            {debugTab === 'dust' && <DustDebug state={walletState} onInspect={inspectHash} />}
            {debugTab === 'shielded' && <ShieldedDebug state={walletState} />}
            {debugTab === 'unshielded' && <UnshieldedDebug state={walletState} onInspect={inspectHash} />}
            {debugTab === 'txns' && <TxHistoryTab entries={txHistory} onInspect={inspectHash} />}
          </div>
        </div>
      </div>

      {/* ── Bottom: Explorer panel (always visible) ── */}
      <div className="h-[220px] shrink-0 bg-midnight-800 border-t border-midnight-500 flex flex-col">
        <div className="flex items-center gap-2 px-3 pt-1.5 pb-1 shrink-0">
          <span className="text-[9px] uppercase tracking-wider text-gray-500">Explorer</span>
          {inspectorTarget && (
            <>
              {inspectorHistory.length > 0 && (
                <button
                  onClick={inspectorBack}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-midnight-700 text-gray-400 hover:text-gray-200"
                >
                  Back
                </button>
              )}
              <button
                onClick={inspectorClose}
                className="text-[10px] px-1.5 py-0.5 rounded bg-midnight-700 text-gray-400 hover:text-gray-200"
              >
                Clear
              </button>
            </>
          )}
          <div className="flex-1" />
          {inspectorTarget != null && inspectorData != null && (
            <CopyBtn getData={() => JSON.stringify(inspectorData, null, 2)} />
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2">
          {inspectorTarget ? (
            <Inspector
              target={inspectorTarget}
              environment={walletState.environment}
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

      {/* Modals */}
      <TransferModal open={transferOpen} onClose={() => setTransferOpen(false)} />
      {dustMode && <DustModal open={true} onClose={() => setDustMode(null)} mode={dustMode} />}
    </div>
  );
}

/* ── Address row ── */

function AddrRow({ label, address }: { label: string; address: string }) {
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
    <div className="flex items-center gap-1.5 text-[11px] bg-white/5 rounded px-2 py-1">
      <span className="text-gray-500 w-14 shrink-0">{label}</span>
      <span className="font-mono text-gray-300 truncate flex-1" title={address}>{short}</span>
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

/* ── Token rows ── */

function TokenRows({ label, balances }: { label: string; balances: Record<string, string> }) {
  const entries = Object.entries(balances).filter(([, v]) => v !== '0');
  if (entries.length === 0) return null;
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-0.5">{label}</div>
      {entries.map(([tokenId, amount]) => {
        const isNight = tokenId === NIGHT_TOKEN_ID;
        return (
          <div key={tokenId} className="flex justify-between text-[11px] px-1">
            <span className="text-gray-400 font-mono truncate mr-2">
              {isNight ? 'NIGHT' : `${tokenId.slice(0, 8)}...`}
            </span>
            <span className="text-white font-mono">
              {isNight ? formatBigInt(amount, NIGHT_DENOMINATION) : amount}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Debug tabs ── */

function SyncRow({ progress, percent }: { progress: SyncProgress; percent: number }) {
  return (
    <div className="mb-1.5">
      <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
        <span>{progress.connected ? 'Connected' : 'Disconnected'}</span>
        <span>{progress.applied} / {progress.highest} ({percent}%)</span>
      </div>
      <div className="w-full h-1 bg-midnight-900 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${progress.connected ? 'bg-gradient-to-r from-accent-purple to-accent-magenta' : 'bg-gray-600'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-[11px]">
      <span className="text-gray-500">{k}</span>
      <span className="text-gray-200 font-mono">{v}</span>
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return <div className="text-[9px] uppercase tracking-wider text-gray-500 pt-0.5">{label}</div>;
}

function DustDebug({ state, onInspect }: {
  state: SerializedWalletState;
  onInspect?: ((hash: string) => void) | undefined;
}) {
  return (
    <div className="space-y-1">
      <SyncRow progress={state.dust.progress} percent={state.dust.syncPercent} />
      <KV k="Balance" v={formatLargeNumber(BigInt(state.dust.balance), DUST_DENOMINATION)} />
      <KV k="Address" v={trunc(state.dust.address)} />
      <Divider label={`UTXOs (${state.unshielded.utxos.length})`} />
      <UtxoList utxos={state.unshielded.utxos} onInspect={onInspect ?? (() => {})} />
    </div>
  );
}

function ShieldedDebug({ state }: { state: SerializedWalletState }) {
  const entries = Object.entries(state.shielded.balances);
  return (
    <div className="space-y-1">
      <SyncRow progress={state.shielded.progress} percent={state.shielded.syncPercent} />
      <KV k="Coins" v={String(state.shielded.coinCount)} />
      <Divider label="Balances" />
      {entries.length === 0 ? (
        <div className="text-[11px] text-gray-500">None</div>
      ) : entries.map(([id, amt]) => (
        <KV key={id}
          k={id === NIGHT_TOKEN_ID ? 'NIGHT' : `${id.slice(0, 10)}...`}
          v={id === NIGHT_TOKEN_ID ? formatLargeNumber(BigInt(amt), NIGHT_DENOMINATION) : amt}
        />
      ))}
    </div>
  );
}

function UnshieldedDebug({ state, onInspect }: {
  state: SerializedWalletState;
  onInspect?: ((hash: string) => void) | undefined;
}) {
  const entries = Object.entries(state.unshielded.balances);
  const reg = state.unshielded.utxos.filter((u) => u.registered);
  const unreg = state.unshielded.utxos.filter((u) => !u.registered);
  return (
    <div className="space-y-1">
      <SyncRow progress={state.unshielded.progress} percent={state.unshielded.syncPercent} />
      <KV k="UTXOs" v={String(state.unshielded.utxos.length)} />
      <KV k="Registered" v={`${reg.length} / ${state.unshielded.utxos.length}`} />
      <KV k="Unregistered" v={String(unreg.length)} />
      <Divider label="Balances" />
      {entries.length === 0 ? (
        <div className="text-[11px] text-gray-500">None</div>
      ) : entries.map(([id, amt]) => (
        <KV key={id}
          k={id === NIGHT_TOKEN_ID ? 'NIGHT' : `${id.slice(0, 10)}...`}
          v={id === NIGHT_TOKEN_ID ? formatLargeNumber(BigInt(amt), NIGHT_DENOMINATION) : amt}
        />
      ))}
      <Divider label={`UTXOs (${state.unshielded.utxos.length})`} />
      <UtxoList utxos={state.unshielded.utxos} onInspect={onInspect ?? (() => {})} />
    </div>
  );
}

function TxHistoryTab({ entries, onInspect }: {
  entries: TxHistoryEntry[];
  onInspect: (hash: string) => void;
}) {
  if (entries.length === 0) {
    return <div className="text-[11px] text-gray-500 py-4 text-center">No transactions yet</div>;
  }
  return (
    <div className="space-y-1">
      {entries.map((tx) => (
        <div key={tx.txHash} className="bg-midnight-700 rounded px-2 py-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-gray-300">{TX_TYPE_LABELS[tx.type] ?? tx.type}</span>
            <span className={TX_STATUS_COLORS[tx.status] ?? 'text-gray-400'}>{tx.status}</span>
          </div>
          <div className="flex items-center justify-between text-[10px] mt-0.5">
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

function UtxoList({ utxos, onInspect }: {
  utxos: SerializedUtxo[];
  onInspect: (hash: string) => void;
}) {
  if (utxos.length === 0) {
    return <div className="text-[11px] text-gray-500">No UTXOs</div>;
  }
  return (
    <div className="space-y-0.5">
      {utxos.map((utxo) => {
        const intentHash = utxo.id.split(':')[0] ?? '';
        return (
          <div key={utxo.id} className="flex items-center justify-between text-[10px] px-1.5 py-0.5 bg-midnight-700 rounded">
            <button onClick={() => onInspect(intentHash)}
              className="font-mono text-accent-purple hover:underline truncate mr-2 text-left" title="Inspect transaction">
              {utxo.id.slice(0, 24)}...
            </button>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="font-mono text-white">
                {formatLargeNumber(BigInt(utxo.value), NIGHT_DENOMINATION)}
              </span>
              <span className={`text-[8px] px-1 rounded ${utxo.registered ? 'bg-green-900/40 text-green-400' : 'bg-gray-700 text-gray-500'}`}
                title={utxo.registered ? 'Registered for dust generation' : 'Not registered'}>
                {utxo.registered ? 'REG' : 'UNREG'}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Shared ── */

const TX_TYPE_LABELS: Record<string, string> = {
  transfer: 'Transfer', dustReg: 'Dust Reg', dustDereg: 'Dust Dereg', dappTx: 'DApp Tx',
};
const TX_STATUS_COLORS: Record<string, string> = {
  pending: 'text-amber-400', confirmed: 'text-green-400', finalized: 'text-green-300', discarded: 'text-red-400',
};

function CopyBtn({ getData }: { getData: () => string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(getData()); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="text-[9px] px-1.5 py-0.5 rounded bg-midnight-700 text-gray-500 hover:text-gray-200"
      title="Copy as JSON"
    >
      {copied ? 'Copied!' : 'Copy'}
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

function Spinner() {
  return (
    <svg className="animate-spin h-5 w-5 mr-2 text-accent-purple" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
