import type {
  DiagnosticCategory,
  DiagnosticEvent,
  DiagnosticLevel,
} from '@shared/types';

const MAX_EVENTS = 2000;

export const sessionId = crypto.randomUUID();

let nextId = 1;
const buffer: DiagnosticEvent[] = [];

let broadcastFn: ((event: DiagnosticEvent) => void) | null = null;

export function setBroadcastFn(fn: (event: DiagnosticEvent) => void): void {
  broadcastFn = fn;
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
  if (broadcastFn) {
    try {
      broadcastFn(event);
    } catch {
      // Broadcast errors must not break the logger
    }
  }
}

export function getBacklog(): DiagnosticEvent[] {
  return [...buffer];
}
