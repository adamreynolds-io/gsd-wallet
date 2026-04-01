/**
 * Injected into the page's main world.
 * Installs window.midnight[uuid] with InitialAPI.
 * All ConnectedAPI methods are proxied through postMessage to the content script.
 */
export {};

declare global {
  interface Window {
    midnight?: Record<string, unknown>;
  }
}

const INPAGE_SOURCE = 'gsd-wallet-inpage';
const CONTENT_SOURCE = 'gsd-wallet-content';

let requestCounter = 0;

function sendRequest(payload: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const requestId = `gsd-${Date.now()}-${++requestCounter}`;

    const timeout = setTimeout(() => {
      window.removeEventListener('message', handleResponse);
      const err = new Error('Request timed out after 120s') as Error & {
        type: string;
        code: string;
        reason: string;
      };
      err.type = 'DAppConnectorAPIError';
      err.code = 'InternalError';
      err.reason = 'Request timed out after 120s';
      reject(err);
    }, 120_000);

    function handleResponse(event: MessageEvent) {
      if (event.source !== window) return;
      if (event.data?.source !== CONTENT_SOURCE) return;
      if (event.data?.requestId !== requestId) return;
      clearTimeout(timeout);
      window.removeEventListener('message', handleResponse);

      const { payload: resp } = event.data;
      if (resp.type === 'GSD_ERROR') {
        const err = new Error(resp.error.reason) as Error & {
          type: string;
          code: string;
          reason: string;
        };
        err.type = 'DAppConnectorAPIError';
        err.code = resp.error.code;
        err.reason = resp.error.reason;
        reject(err);
      } else {
        resolve(resp.result);
      }
    }

    window.addEventListener('message', handleResponse);

    window.postMessage(
      {
        source: INPAGE_SOURCE,
        requestId,
        payload,
      },
      window.location.origin,
    );
  });
}

/**
 * Methods whose response contains bigint values serialized as strings.
 * The inpage script converts them back to native bigint before returning to dApp.
 */
const BIGINT_RECORD_METHODS = new Set([
  'getShieldedBalances',
  'getUnshieldedBalances',
]);

const BIGINT_FIELDS_METHODS: Record<string, string[]> = {
  getDustBalance: ['cap', 'balance'],
};

function deserializeBigInts(method: string, result: unknown): unknown {
  if (BIGINT_RECORD_METHODS.has(method) && result && typeof result === 'object') {
    const converted: Record<string, bigint> = {};
    for (const [k, v] of Object.entries(result as Record<string, unknown>)) {
      converted[k] = BigInt(v as string);
    }
    return converted;
  }

  const fields = BIGINT_FIELDS_METHODS[method];
  if (fields && result && typeof result === 'object') {
    const obj = { ...(result as Record<string, unknown>) };
    for (const field of fields) {
      if (field in obj) {
        obj[field] = BigInt(obj[field] as string);
      }
    }
    return obj;
  }

  return result;
}

function makeApiProxy(sessionId: string): Record<string, (...args: unknown[]) => Promise<unknown>> {
  const methods = [
    'getShieldedBalances',
    'getUnshieldedBalances',
    'getDustBalance',
    'getShieldedAddresses',
    'getUnshieldedAddress',
    'getDustAddress',
    'getTxHistory',
    'balanceUnsealedTransaction',
    'balanceSealedTransaction',
    'makeTransfer',
    'makeIntent',
    'signData',
    'submitTransaction',
    'getProvingProvider',
    'getConfiguration',
    'getConnectionStatus',
    'hintUsage',
  ];

  const proxy: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const method of methods) {
    proxy[method] = async (...args: unknown[]) => {
      const result = await sendRequest({
        type: 'GSD_API_CALL',
        method,
        args,
        sessionId,
      });
      return deserializeBigInts(method, result);
    };
  }
  return proxy;
}

interface InitialAPI {
  rdns: string;
  name: string;
  icon: string;
  apiVersion: string;
  connect(networkId: string): Promise<unknown>;
}

const walletId = crypto.randomUUID();

const initialApi: InitialAPI = {
  rdns: 'io.shielded.gsd',
  name: 'Midnight GSD Wallet',
  icon: '',
  apiVersion: '4.0.1',

  async connect(networkId: string): Promise<unknown> {
    const result = await sendRequest({
      type: 'GSD_CONNECT',
      networkId,
      origin: window.location.origin,
    });

    // result is the sessionId
    const sessionId = result as string;
    return makeApiProxy(sessionId);
  },
};

if (!window.midnight) {
  window.midnight = {};
}
window.midnight[walletId] = initialApi;
window.dispatchEvent(new CustomEvent('midnight#ready', { detail: { uuid: walletId } }));

console.log('[GSD] Wallet injected as window.midnight.' + walletId);
