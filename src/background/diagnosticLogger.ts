import type {
  DiagnosticCategory,
  DiagnosticEvent,
  DiagnosticLevel,
} from '@shared/types';

const MAX_EVENTS = 2000;
const FLUSH_DELAY_MS = 100;
const FLUSH_BATCH_SIZE = 3;
const STORAGE_KEY = 'gsdDiagnosticEvents';

export const sessionId = crypto.randomUUID();

let nextId = 1;
const buffer: DiagnosticEvent[] = [];
const listeners: Array<(event: DiagnosticEvent) => void> = [];

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSince = 0;

function scheduleFlush(): void {
  if (!pendingSince) {
    pendingSince = buffer.length;
  }
  if (buffer.length - pendingSince >= FLUSH_BATCH_SIZE) {
    flush();
    return;
  }
  if (!flushTimer) {
    flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
  }
}

function flush(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  pendingSince = 0;
  chrome.storage.local.set({ [STORAGE_KEY]: buffer });
}

export function emit(
  level: DiagnosticLevel,
  category: DiagnosticCategory,
  message: string,
  data?: unknown,
  elapsed?: number,
): void {
  const event: DiagnosticEvent = {
    id: nextId++,
    timestamp: Date.now(),
    level,
    category,
    message,
    ...(data !== undefined ? { data } : {}),
    ...(elapsed !== undefined ? { elapsed } : {}),
  };
  buffer.push(event);
  if (buffer.length > MAX_EVENTS) {
    buffer.splice(0, buffer.length - MAX_EVENTS);
  }
  scheduleFlush();
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Listener errors must not break the logger
    }
  }
}

export function getBacklog(): DiagnosticEvent[] {
  return [...buffer];
}

export function onEvent(cb: (event: DiagnosticEvent) => void): () => void {
  listeners.push(cb);
  return () => {
    const idx = listeners.indexOf(cb);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

/**
 * Restore events from a previous service worker lifecycle.
 * Call once at SW startup, before emitting any new events.
 */
export async function rehydrate(): Promise<void> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const events = stored[STORAGE_KEY] as DiagnosticEvent[] | undefined;
  if (events && events.length > 0) {
    buffer.push(...events);
    if (buffer.length > MAX_EVENTS) {
      buffer.splice(0, buffer.length - MAX_EVENTS);
    }
    const last = buffer[buffer.length - 1];
    if (last) nextId = last.id + 1;
  }
}
