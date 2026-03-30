import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { usePopupStore } from '@popup/store/popupStore';
import type {
  DiagnosticEvent,
  DiagnosticLevel,
  DiagnosticCategory,
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
  indexer: 'Idx', storage: 'Sto', error: 'Err',
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
};

export function DiagnosticsPanel() {
  const events = usePopupStore((s) => s.diagnosticEvents);
  const levelFilter = usePopupStore((s) => s.diagnosticLevelFilter);
  const categoryFilter = usePopupStore((s) => s.diagnosticCategoryFilter);
  const setLevel = usePopupStore((s) => s.setDiagnosticLevel);
  const setCategory = usePopupStore((s) => s.setDiagnosticCategory);
  const clearEvents = usePopupStore((s) => s.clearDiagnosticEvents);

  const filtered = useMemo(
    () => events.filter((e) => levelFilter[e.level] && categoryFilter[e.category]),
    [events, levelFilter, categoryFilter],
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
              <EventRow key={event.id} event={event} expandCollapseSignal={expandCollapseSignal} />
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

function EventRow({ event, expandCollapseSignal }: { event: DiagnosticEvent; expandCollapseSignal: { action: 'expand' | 'collapse'; tick: number } }) {
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



      {expanded && hasData && (
        <div className="px-2 pb-1">
          <pre className="text-xs text-gray-400 font-mono bg-midnight-900 rounded p-1.5 overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap break-all">
            {JSON.stringify(event.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

const ICONS = {
  copy: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>,
  download: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>,
  trash: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>,
  check: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4caf50" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>,
} as const;

function downloadLogs(events: DiagnosticEvent[]): void {
  const ndjson = events.map((e) => JSON.stringify(e)).join('\n');
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
