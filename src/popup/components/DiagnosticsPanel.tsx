import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { usePopupStore } from '@popup/store/popupStore';
import type {
  DiagnosticEvent,
  DiagnosticLevel,
  DiagnosticCategory,
  InspectorTarget,
} from '@shared/types';
import { DIAGNOSTIC_LEVELS, DIAGNOSTIC_CATEGORIES } from '@shared/types';

const LEVEL_COLORS: Record<DiagnosticLevel, string> = {
  debug: 'bg-gray-700 text-gray-400',
  info: 'bg-blue-900/60 text-blue-400',
  warn: 'bg-amber-900/60 text-amber-400',
  error: 'bg-red-900/60 text-red-400',
};

const LEVEL_CHECK_COLORS: Record<DiagnosticLevel, string> = {
  debug: 'text-gray-400',
  info: 'text-blue-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
};

const CATEGORY_COLORS: Record<DiagnosticCategory, string> = {
  sw: 'text-gray-400',
  wallet: 'text-green-400',
  state: 'text-cyan-400',
  sync: 'text-emerald-400',
  sdk: 'text-orange-400',
  dapp: 'text-purple-400',
  api: 'text-blue-400',
  popup: 'text-indigo-400',
  tx: 'text-amber-400',
  indexer: 'text-teal-400',
  storage: 'text-gray-500',
  error: 'text-red-400',
  connect: 'text-lime-400',
  proving: 'text-fuchsia-400',
};

const LEVEL_LABELS: Record<DiagnosticLevel, string> = {
  debug: 'DBG', info: 'INF', warn: 'WRN', error: 'ERR',
};

const LEVEL_TOOLTIPS: Record<DiagnosticLevel, string> = {
  debug: 'Debug — verbose diagnostic output',
  info: 'Info — normal operations',
  warn: 'Warning — potential issues',
  error: 'Error — failures and exceptions',
};

const CATEGORY_SHORT: Record<DiagnosticCategory, string> = {
  sw: 'SW', wallet: 'Wal', state: 'Sta', sync: 'Sync', sdk: 'SDK',
  dapp: 'DApp', api: 'API', popup: 'Pop', tx: 'Tx',
  indexer: 'Idx', storage: 'Sto', error: 'Err', connect: 'Conn', proving: 'Prv',
};

const CATEGORY_TOOLTIPS: Record<DiagnosticCategory, string> = {
  sw: 'Service worker lifecycle',
  wallet: 'Wallet init, keys, facade',
  state: 'Sync status transitions',
  sync: 'Per-wallet sync progress, connections, phase transitions',
  sdk: 'Wallet-SDK internal messages (WebSocket, RPC, @polkadot)',
  dapp: 'DApp connect/disconnect',
  api: 'DApp API method calls',
  popup: 'Popup message handling',
  tx: 'Transaction phases (balance, sign, prove, submit)',
  indexer: 'GraphQL indexer queries',
  storage: 'IndexedDB operations',
  error: 'Errors at any layer',
  connect: 'GSD Connect — trace events from external dApp or test harness',
  proving: 'ZK proof generation — WASM/server routing, key material, benchmark',
};

interface DiagnosticsPanelProps {
  onInspect?: (target: InspectorTarget) => void;
}

function useSearchFilter() {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onChange = useCallback((value: string) => {
    setInput(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setQuery(value.length >= 3 ? value.toLowerCase() : '');
    }, 250);
  }, []);

  const clear = useCallback(() => {
    setInput('');
    setQuery('');
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { input, query, onChange, clear };
}

function matchesSearch(event: DiagnosticEvent, query: string): boolean {
  if (event.message.toLowerCase().includes(query)) return true;
  if (event.data !== undefined) {
    const json = JSON.stringify(event.data).toLowerCase();
    if (json.includes(query)) return true;
  }
  return false;
}

export function DiagnosticsPanel({ onInspect }: DiagnosticsPanelProps) {
  const events = usePopupStore((s) => s.diagnosticEvents);
  const levelFilter = usePopupStore((s) => s.diagnosticLevelFilter);
  const categoryFilter = usePopupStore((s) => s.diagnosticCategoryFilter);
  const setLevel = usePopupStore((s) => s.setDiagnosticLevel);
  const setCategory = usePopupStore((s) => s.setDiagnosticCategory);
  const clearEvents = usePopupStore((s) => s.clearDiagnosticEvents);
  const search = useSearchFilter();

  const filtered = useMemo(
    () => events.filter((e) =>
      levelFilter[e.level] &&
      categoryFilter[e.category] &&
      (!search.query || matchesSearch(e, search.query)),
    ),
    [events, levelFilter, categoryFilter, search.query],
  );

  const [expandCollapseSignal, setExpandCollapseSignal] = useState<{ action: 'expand' | 'collapse'; tick: number }>({ action: 'collapse', tick: 0 });

  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => {
      setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 50);
    };
    el.addEventListener('scroll', handler);
    return () => el.removeEventListener('scroll', handler);
  }, []);

  useEffect(() => {
    if (atBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filtered.length, atBottom]);

  const jumpToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setAtBottom(true);
    }
  }, []);

  const copyAll = useCallback(() => {
    const json = JSON.stringify(filtered, null, 2);
    navigator.clipboard.writeText(json);
  }, [filtered]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-midnight-900">
      {/* Header: title + level filters + actions */}
      <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-1 shrink-0 border-b border-midnight-500">
        <span className="text-xs uppercase tracking-wider text-gray-500">Events</span>
        <span className="text-xs text-gray-600">({filtered.length})</span>
        <span className="mx-0.5 text-midnight-500">|</span>
        <SelectAllCheck
          checked={DIAGNOSTIC_LEVELS.every((l) => levelFilter[l])}
          onChange={(on) => DIAGNOSTIC_LEVELS.forEach((l) => setLevel(l, on))}
          title="Toggle all log levels"
        />
        {DIAGNOSTIC_LEVELS.map((level) => (
          <label key={level} className={`flex items-center gap-0.5 text-xs cursor-pointer ${LEVEL_CHECK_COLORS[level]}`} title={LEVEL_TOOLTIPS[level]}>
            <input
              type="checkbox"
              checked={levelFilter[level]}
              onChange={(e) => setLevel(level, e.target.checked)}
              className="w-3 h-3 rounded accent-current"
            />
            {LEVEL_LABELS[level]}
          </label>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => setExpandCollapseSignal({ action: 'expand', tick: Date.now() })}
          className="p-0.5 rounded text-gray-500 hover:text-gray-200 hover:bg-midnight-800 font-mono text-xs"
          title="Expand all"
        >+</button>
        <button
          onClick={() => setExpandCollapseSignal({ action: 'collapse', tick: Date.now() })}
          className="p-0.5 rounded text-gray-500 hover:text-gray-200 hover:bg-midnight-800 font-mono text-xs"
          title="Collapse all"
        >&minus;</button>
        <IconBtn icon="copy" title="Copy all visible events as JSON" onClick={copyAll} />
        <IconBtn icon="download" title="Download all events as NDJSON" onClick={() => downloadLogs(events)} />
        <IconBtn icon="trash" title="Clear events" onClick={clearEvents} />
      </div>

      {/* Category filters */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-2 py-0.5 shrink-0 border-b border-midnight-500">
        <SelectAllCheck
          checked={DIAGNOSTIC_CATEGORIES.every((c) => categoryFilter[c])}
          onChange={(on) => DIAGNOSTIC_CATEGORIES.forEach((c) => setCategory(c, on))}
          title="Toggle all categories"
        />
        {DIAGNOSTIC_CATEGORIES.map((cat) => (
          <label key={cat} className={`flex items-center gap-0.5 text-xs cursor-pointer ${CATEGORY_COLORS[cat]}`} title={CATEGORY_TOOLTIPS[cat]}>
            <input
              type="checkbox"
              checked={categoryFilter[cat]}
              onChange={(e) => setCategory(cat, e.target.checked)}
              className="w-3 h-3 rounded accent-current"
            />
            {CATEGORY_SHORT[cat]}
          </label>
        ))}
        <div className="relative ml-auto">
          <input
            type="text"
            value={search.input}
            onChange={(e) => search.onChange(e.target.value)}
            placeholder="search..."
            className="text-xs bg-midnight-800 text-gray-300 border border-midnight-500 rounded px-1.5 py-0.5 w-24 focus:w-36 transition-all focus:outline-none focus:border-gray-500 placeholder-gray-600"
          />
          {search.input && (
            <button
              onClick={search.clear}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs leading-none"
              title="Clear search"
            >
              x
            </button>
          )}
        </div>
      </div>

      {/* Event list */}
      <div className="flex-1 min-h-0 relative">
        <div ref={scrollRef} className="absolute inset-0 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-600 text-sm">
              No events
            </div>
          ) : (
            filtered.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                expandCollapseSignal={expandCollapseSignal}
                {...(onInspect !== undefined ? { onInspect } : {})}
              />
            ))
          )}
        </div>
        {!atBottom && filtered.length > 0 && (
          <button
            onClick={jumpToBottom}
            className="absolute bottom-2 right-3 bg-accent-purple text-white text-xs px-2 py-1 rounded-full shadow-lg hover:bg-accent-magenta"
          >
            &#8595; Latest
          </button>
        )}
      </div>
    </div>
  );
}

function EventRow({ event, expandCollapseSignal, onInspect }: {
  event: DiagnosticEvent;
  expandCollapseSignal: { action: 'expand' | 'collapse'; tick: number };
  onInspect?: (target: InspectorTarget) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (expandCollapseSignal.tick === 0) return;
    if (expandCollapseSignal.action === 'collapse') setExpanded(false);
    if (expandCollapseSignal.action === 'expand' && event.data !== undefined) setExpanded(true);
  }, [expandCollapseSignal, event.data]);

  const ts = new Date(event.timestamp);
  const timeStr = `${pad(ts.getHours())}:${pad(ts.getMinutes())}:${pad(ts.getSeconds())}.${String(ts.getMilliseconds()).padStart(3, '0')}`;

  const copyEvent = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(event, null, 2));
  }, [event]);

  const hasData = event.data !== undefined;

  const links = extractLinks(event.data, onInspect);

  const failedTxData = event.data && typeof event.data === 'object' && 'txHex' in event.data
    ? (event.data as Record<string, unknown>)
    : null;
  const hasFailedTxData = failedTxData !== null
    && typeof failedTxData['txHex'] === 'string'
    && (failedTxData['txHex'] as string).length > 0;

  const downloadFailedTx = useCallback(() => {
    if (!failedTxData) return;
    const diagnostic = {
      version: 1,
      timestamp: new Date(event.timestamp).toISOString(),
      method: failedTxData['method'] ?? null,
      markers: failedTxData['markers'] ?? null,
      txHex: failedTxData['txHex'] ?? null,
      ledgerParamsHex: failedTxData['ledgerParamsHex'] ?? null,
      error: failedTxData['error'] ?? null,
      versions: {
        ...(failedTxData['versions'] as Record<string, string> ?? {}),
        gsdWallet: chrome.runtime.getManifest().version,
      },
    };
    const blob = new Blob(
      [JSON.stringify(diagnostic, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `failed-tx-${event.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [failedTxData, event.id, event.timestamp]);

  return (
    <div className="border-b border-midnight-800 hover:bg-midnight-800/50">
      <div
        className={`flex items-center gap-1 px-2 py-0.5 ${hasData ? 'cursor-pointer' : ''}`}
        onClick={() => { if (hasData) setExpanded((e) => !e); }}
      >
        <span className="text-xs font-mono text-gray-500 shrink-0 w-[72px]">{timeStr}</span>
        <span className={`text-xs font-mono px-1 rounded shrink-0 ${LEVEL_COLORS[event.level]}`}>
          {LEVEL_LABELS[event.level]}
        </span>
        <span className={`text-xs shrink-0 ${CATEGORY_COLORS[event.category]}`}>{event.category}</span>
        <span className="text-xs text-gray-300 truncate flex-1 min-w-0">
          {event.message}
        </span>
        {event.elapsed !== undefined && (
          <span className="text-xs text-gray-500 shrink-0">{formatElapsed(event.elapsed)}</span>
        )}
        {hasData && (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
            className="text-gray-600 hover:text-gray-300 shrink-0 font-mono text-xs w-3 text-center"
            title={expanded ? 'Collapse details' : 'Expand details'}
          >
            {expanded ? '\u2212' : '+'}
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); copyEvent(); }}
          className="text-gray-600 hover:text-gray-300 shrink-0"
          title="Copy this event as JSON to clipboard"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
        </button>
      </div>
      {(links.length > 0 || hasFailedTxData) && (
        <div className="flex flex-wrap gap-1 px-2 pb-0.5 pl-[88px]">
          {links.map((tag, i) => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); tag.action(); }}
              className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent-purple/20 text-accent-purple hover:bg-accent-purple/40 hover:text-white"
              title={`Open ${tag.title} in Explorer`}
            >
              {tag.label}
            </button>
          ))}
          {hasFailedTxData && (
            <button
              onClick={(e) => { e.stopPropagation(); downloadFailedTx(); }}
              className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-900/30 text-red-400 hover:bg-red-900/50 hover:text-white flex items-center gap-0.5"
              title="Download failed transaction diagnostic JSON"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              tx.json
            </button>
          )}
        </div>
      )}



      {expanded && hasData && (
        <div className="px-2 pb-1">
          <div className="text-xs text-gray-400 font-mono bg-midnight-900 rounded p-1.5 overflow-x-auto max-h-[200px] overflow-y-auto">
            <DataRenderer data={event.data} {...(onInspect !== undefined ? { onInspect } : {})} />
          </div>
        </div>
      )}
    </div>
  );
}

const HEX64_RE = /^[0-9a-f]{64}$/;

function isBlockKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.includes('block') && (lower.includes('height') || lower.endsWith('block'));
}

function isContractKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.includes('contract') || lower.includes('address');
}

function ValueRenderer({ keyName, value, onInspect }: {
  keyName: string;
  value: unknown;
  onInspect?: (target: InspectorTarget) => void;
}) {
  if (typeof value === 'string' && HEX64_RE.test(value) && onInspect) {
    const target: InspectorTarget = isContractKey(keyName)
      ? { kind: 'contract', address: value }
      : { kind: 'transaction', hash: value };
    const label = keyName.toLowerCase().includes('contract') ? 'contract' : 'tx';
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onInspect(target); }}
        className="text-accent-purple hover:text-accent-magenta underline decoration-dotted cursor-pointer break-all text-left"
        title={`Open ${label} in Explorer`}
      >
        {value}
      </button>
    );
  }

  if (typeof value === 'number' && isBlockKey(keyName) && onInspect) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onInspect({ kind: 'block', height: value }); }}
        className="text-accent-purple hover:text-accent-magenta underline decoration-dotted cursor-pointer"
        title="Open block in Explorer"
      >
        {value}
      </button>
    );
  }

  if (typeof value === 'object' && value !== null) {
    return <span className="break-all whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</span>;
  }

  return <span className="break-all">{JSON.stringify(value)}</span>;
}

const HIDDEN_DATA_KEYS = new Set(['txHex', 'ledgerParamsHex']);

function DataRenderer({ data, onInspect }: { data: unknown; onInspect?: (target: InspectorTarget) => void }) {
  if (typeof data !== 'object' || data === null) {
    return <span>{JSON.stringify(data)}</span>;
  }

  const entries = Object.entries(data as Record<string, unknown>)
    .filter(([key]) => !HIDDEN_DATA_KEYS.has(key));

  return (
    <div className="space-y-0.5">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-1">
          <span className="text-gray-500 shrink-0">{key}:</span>
          <ValueRenderer keyName={key} value={value} {...(onInspect !== undefined ? { onInspect } : {})} />
        </div>
      ))}
    </div>
  );
}

function truncHex(hex: string): string {
  return hex.length > 16 ? `${hex.slice(0, 8)}..${hex.slice(-6)}` : hex;
}

interface LinkTag {
  label: string;
  title: string;
  action: () => void;
}

function extractLinks(data: unknown, onInspect?: (target: InspectorTarget) => void): LinkTag[] {
  if (!onInspect || !data || typeof data !== 'object') return [];
  const obj = data as Record<string, unknown>;
  const tags: LinkTag[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && HEX64_RE.test(value)) {
      if (isContractKey(key)) {
        const addr = value;
        tags.push({ label: `contract:${truncHex(value)}`, title: value, action: () => onInspect({ kind: 'contract', address: addr }) });
      } else {
        const hash = value;
        tags.push({ label: `tx:${truncHex(value)}`, title: value, action: () => onInspect({ kind: 'transaction', hash }) });
      }
    }
    if (typeof value === 'number' && isBlockKey(key)) {
      const height = value;
      tags.push({ label: `block:${height}`, title: `Block ${height}`, action: () => onInspect({ kind: 'block', height }) });
    }
  }

  return tags;
}

const ICONS = {
  copy: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>,
  download: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>,
  trash: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>,
  check: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4caf50" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>,
} as const;

function downloadLogs(events: DiagnosticEvent[]): void {
  const ndjson = events.map((e) => JSON.stringify({
    ...e,
    time: new Date(e.timestamp).toISOString(),
  })).join('\n');
  const blob = new Blob([ndjson], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gsd-diagnostics-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.ndjson`;
  a.click();
  URL.revokeObjectURL(url);
}

function SelectAllCheck({ checked, onChange, title }: {
  checked: boolean;
  onChange: (on: boolean) => void;
  title: string;
}) {
  return (
    <label className="flex items-center gap-0.5 text-xs cursor-pointer text-gray-500" title={title}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-3 h-3 rounded accent-current"
      />
      All
    </label>
  );
}

function IconBtn({ icon, title, onClick }: { icon: keyof typeof ICONS; title: string; onClick: () => void }) {
  const [flash, setFlash] = useState(false);
  return (
    <button
      onClick={() => { onClick(); if (icon === 'copy') { setFlash(true); setTimeout(() => setFlash(false), 1200); } }}
      className="p-0.5 rounded text-gray-500 hover:text-gray-200 hover:bg-midnight-800"
      title={title}
    >
      {flash ? ICONS.check : ICONS[icon]}
    </button>
  );
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
