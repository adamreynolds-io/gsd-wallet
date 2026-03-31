import { emit } from './diagnosticLogger';

const SDK_PATTERNS = [
  'RPC-CORE',
  'disconnected from',
  'WebSocket',
  '@midnight',
  '@polkadot',
  'JSONRPC',
  'midnight-ntwrk',
  'WsProvider',
  'Api will be available',
  'isConnected',
];

function isSdkMessage(msg: string): boolean {
  return SDK_PATTERNS.some((p) => msg.includes(p));
}

function formatArgs(args: unknown[]): string {
  return args.map((a) => {
    if (typeof a === 'string') return a;
    if (typeof a === 'object' && a !== null) {
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    }
    return String(a);
  }).join(' ');
}

/**
 * Monkey-patch console.warn and console.error to capture SDK-internal
 * messages (e.g., @polkadot/api WebSocket disconnects, RPC errors).
 *
 * Must be called before any SDK imports to catch all messages.
 */
export function interceptSdkConsole(): void {
  const originalWarn = console.warn;
  const originalError = console.error;

  console.warn = (...args: unknown[]) => {
    originalWarn.apply(console, args);
    const message = formatArgs(args);
    if (isSdkMessage(message)) {
      emit('warn', 'sdk', message);
    }
  };

  console.error = (...args: unknown[]) => {
    originalError.apply(console, args);
    const message = formatArgs(args);
    if (isSdkMessage(message)) {
      emit('error', 'sdk', message);
    }
  };
}
