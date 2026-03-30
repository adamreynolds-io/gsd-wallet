import type { DiagnosticCategory, DiagnosticEvent, DiagnosticLevel } from '@shared/types';

const MAX_EVENTS = 500;

let nextId = 1;
const buffer: DiagnosticEvent[] = [];
const listeners: Array<(event: DiagnosticEvent) => void> = [];

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
    buffer.shift();
  }
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
