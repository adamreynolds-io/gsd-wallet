import type {
  DiagnosticLevel,
  DiagnosticEvent,
  ConnectEventPayload,
} from './protocol.js';
import type { GsdConnectServer } from './server.js';

export interface ConnectTracer {
  trace(
    level: DiagnosticLevel,
    message: string,
    data?: unknown,
    elapsed?: number,
  ): void;
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  span<T>(
    name: string,
    fn: () => Promise<T>,
  ): Promise<T>;
  scope(prefix: string): ConnectTracer;
  onEvent(
    handler: (event: DiagnosticEvent) => void,
  ): () => void;
  flush(): void;
}

interface TracerConfig {
  batchSize?: number;
  batchDelayMs?: number;
}

export function createTracer(
  server: GsdConnectServer,
  config: TracerConfig = {},
): ConnectTracer {
  const batchSize = config.batchSize ?? 20;
  const batchDelayMs = config.batchDelayMs ?? 100;
  let queue: ConnectEventPayload[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flushQueue(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    for (const event of queue) {
      server.sendTraceEvent(event);
    }
    queue = [];
  }

  function enqueue(event: ConnectEventPayload): void {
    if (event.level === 'error') {
      server.sendTraceEvent(event);
      return;
    }
    queue.push(event);
    if (queue.length >= batchSize) {
      flushQueue();
      return;
    }
    if (!timer) {
      timer = setTimeout(flushQueue, batchDelayMs);
    }
  }

  function makeTracer(prefix: string): ConnectTracer {
    function prefixed(msg: string): string {
      return prefix ? `${prefix}: ${msg}` : msg;
    }

    return {
      trace(level, message, data, elapsed) {
        enqueue({
          level,
          message: prefixed(message),
          ...(data !== undefined ? { data } : {}),
          ...(elapsed !== undefined ? { elapsed } : {}),
          timestamp: Date.now(),
        });
      },
      debug(message, data) {
        this.trace('debug', message, data);
      },
      info(message, data) {
        this.trace('info', message, data);
      },
      warn(message, data) {
        this.trace('warn', message, data);
      },
      error(message, data) {
        this.trace('error', message, data);
      },
      async span(name, fn) {
        const t0 = Date.now();
        this.trace('info', `${name} started`);
        try {
          const result = await fn();
          this.trace(
            'info',
            `${name} completed`,
            undefined,
            Date.now() - t0,
          );
          return result;
        } catch (err) {
          this.trace(
            'error',
            `${name} failed: ${err instanceof Error ? err.message : String(err)}`,
            undefined,
            Date.now() - t0,
          );
          throw err;
        }
      },
      scope(subprefix) {
        const combined = prefix
          ? `${prefix}/${subprefix}`
          : subprefix;
        return makeTracer(combined);
      },
      onEvent(handler) {
        return server.onDiagnosticEvent(handler);
      },
      flush: flushQueue,
    };
  }

  return makeTracer('');
}
