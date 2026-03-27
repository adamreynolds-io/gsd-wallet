/**
 * Injected into the page's main world.
 * Installs window.midnight[uuid] with InitialAPI.
 * All ConnectedAPI methods are proxied through postMessage to the content script.
 */

const INPAGE_SOURCE = 'gsd-wallet-inpage';
const CONTENT_SOURCE = 'gsd-wallet-content';

let requestCounter = 0;

function sendRequest(payload) {
  return new Promise((resolve, reject) => {
    const requestId = `gsd-${Date.now()}-${++requestCounter}`;

    function handleResponse(event) {
      if (event.source !== window) return;
      if (event.data?.source !== CONTENT_SOURCE) return;
      if (event.data?.requestId !== requestId) return;
      window.removeEventListener('message', handleResponse);

      const resp = event.data.payload;
      if (resp.type === 'GSD_ERROR') {
        const err = new Error(resp.error.reason);
        err.type = 'DAppConnectorAPIError';
        err.code = resp.error.code;
        err.reason = resp.error.reason;
        reject(err);
      } else {
        resolve(resp.result);
      }
    }

    window.addEventListener('message', handleResponse);
    window.postMessage({ source: INPAGE_SOURCE, requestId, payload }, '*');
  });
}

const BIGINT_RECORD_METHODS = new Set([
  'getShieldedBalances',
  'getUnshieldedBalances',
]);

const BIGINT_FIELDS_METHODS = {
  getDustBalance: ['cap', 'balance'],
};

function deserializeBigInts(method, result) {
  if (BIGINT_RECORD_METHODS.has(method) && result && typeof result === 'object') {
    const converted = {};
    for (const [k, v] of Object.entries(result)) {
      converted[k] = BigInt(v);
    }
    return converted;
  }
  const fields = BIGINT_FIELDS_METHODS[method];
  if (fields && result && typeof result === 'object') {
    const obj = { ...result };
    for (const field of fields) {
      if (field in obj) obj[field] = BigInt(obj[field]);
    }
    return obj;
  }
  return result;
}

function makeApiProxy(sessionId) {
  const methods = [
    'getShieldedBalances', 'getUnshieldedBalances', 'getDustBalance',
    'getShieldedAddresses', 'getUnshieldedAddress', 'getDustAddress',
    'getTxHistory', 'balanceUnsealedTransaction', 'balanceSealedTransaction',
    'makeTransfer', 'makeIntent', 'signData', 'submitTransaction',
    'getProvingProvider', 'getConfiguration', 'getConnectionStatus', 'hintUsage',
  ];
  const proxy = {};
  for (const method of methods) {
    proxy[method] = async (...args) => {
      const result = await sendRequest({ type: 'GSD_API_CALL', method, args, sessionId });
      return deserializeBigInts(method, result);
    };
  }
  return proxy;
}

const walletId = crypto.randomUUID();

const initialApi = {
  rdns: 'io.shielded.gsd',
  name: 'Midnight GSD Wallet',
  icon: '',
  apiVersion: '4.0.1',
  async connect(networkId) {
    const sessionId = await sendRequest({
      type: 'GSD_CONNECT',
      networkId,
      origin: window.location.origin,
    });
    return makeApiProxy(sessionId);
  },
};

if (!window.midnight) window.midnight = {};
window.midnight[walletId] = initialApi;
console.log('[GSD] Wallet injected as window.midnight.' + walletId);
