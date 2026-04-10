import { MidnightBech32m, DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import type * as ledgerTypes from '@midnight-ntwrk/ledger-v8';
import * as walletManager from './walletManager';
import { getEnvironmentConfig } from '@shared/environments';
import { emit } from './diagnosticLogger';

// Yield to the event loop between heavy SDK operations so Chrome
// doesn't flag the offscreen document as unresponsive.
const yieldToEventLoop = () => new Promise<void>((r) => setTimeout(r, 0));

type ApiResult = { result: unknown } | { error: { code: string; reason: string } };

function err(code: string, reason: string): ApiResult {
  return { error: { code, reason } };
}

function ok(result: unknown): ApiResult {
  return { result };
}

function requireWallet() {
  const wallet = walletManager.getActiveWallet();
  if (!wallet?.facade) {
    throw { code: 'Disconnected', reason: 'Wallet not initialized' };
  }
  return wallet;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function serializeBigIntRecord(record: Record<string, bigint>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    result[k] = String(v);
  }
  return result;
}

function hexPreview(hex: string): string {
  return hex.length > 64 ? `${hex.slice(0, 64)}... (${hex.length} chars)` : hex;
}

// Shared context for the current API call — allows inner functions to
// pass metadata (like txHash) up to the outer completion event.
let callContext: Record<string, unknown> = {};

export function setCallContext(key: string, value: unknown): void {
  callContext[key] = value;
}

const TX_METHODS = new Set([
  'submitTransaction',
  'balanceUnsealedTransaction',
  'balanceSealedTransaction',
  'makeTransfer',
]);

function emitFailedTxData(method: string, args: unknown[]): void {
  if (TX_METHODS.has(method) && typeof args[0] === 'string') {
    emit('debug', 'tx', `${method}: failed tx data`, {
      method,
      hexLength: args[0].length,
      hexPreview: hexPreview(args[0]),
      txHex: args[0],
    });
  }
}

const TX_HEARTBEAT_MS = 10_000;

export async function handleApiCall(
  method: string,
  args: unknown[],
): Promise<ApiResult> {
  const t0 = Date.now();
  callContext = {};
  emit('info', 'api', `${method} called`, { method, args: args.map((a) => typeof a === 'string' ? hexPreview(a) : a) });

  let heartbeat: ReturnType<typeof setInterval> | null = null;
  if (TX_METHODS.has(method)) {
    emit('debug', 'tx', `${method}: processing — heartbeats pause during CPU-bound WASM steps`, { method });
    heartbeat = setInterval(() => {
      const elapsed = Math.round((Date.now() - t0) / 1000);
      emit('debug', 'tx', `${method}: still processing (${elapsed}s)`, {
        method, elapsed,
      });
    }, TX_HEARTBEAT_MS);
  }

  try {
    await walletManager.waitForReady();

    const result = await handleApiCallInner(method, args);

    if ('error' in result) {
      emitFailedTxData(method, args);
      emit('warn', 'api', `${method} returned error`, { method, error: result.error, ...callContext }, Date.now() - t0);
    } else {
      emit('info', 'api', `${method} completed`, { method, ...callContext }, Date.now() - t0);
    }
    return result;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    emitFailedTxData(method, args);
    emit('error', 'error', `${method} threw`, { method, error: reason }, Date.now() - t0);
    if (e && typeof e === 'object' && 'code' in e && 'reason' in e) {
      return { error: e as { code: string; reason: string } };
    }
    return err('InternalError', reason);
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
}

async function handleApiCallInner(
  method: string,
  args: unknown[],
): Promise<ApiResult> {
  switch (method) {
    case 'getShieldedBalances': {
      const { latestState } = requireWallet();
      if (!latestState) return ok({});
      return ok(serializeBigIntRecord(latestState.shielded.balances));
    }

    case 'getUnshieldedBalances': {
      const { latestState } = requireWallet();
      if (!latestState) return ok({});
      return ok(serializeBigIntRecord(latestState.unshielded.balances));
    }

    case 'getDustBalance': {
      const { latestState } = requireWallet();
      if (!latestState) return ok({ cap: '0', balance: '0' });
      const balance = latestState.dust.balance(new Date());
      return ok({ cap: String(balance), balance: String(balance) });
    }

    case 'getShieldedAddresses': {
      const wallet = requireWallet();
      const { latestState, environment } = wallet;
      if (!latestState) return err('InternalError', 'State not available');
      const nid = getEnvironmentConfig(environment).networkId;
      const addr = latestState.shielded.address;
      const coinPk = latestState.shielded.coinPublicKey;
      const encPk = latestState.shielded.encryptionPublicKey;
      return ok({
        shieldedAddress: addr ? MidnightBech32m.encode(nid, addr).toString() : '',
        shieldedCoinPublicKey: coinPk ? bytesToHex(new Uint8Array(coinPk.data)) : '',
        shieldedEncryptionPublicKey: encPk ? bytesToHex(new Uint8Array(encPk.data)) : '',
      });
    }

    case 'getUnshieldedAddress': {
      const wallet = requireWallet();
      const { latestState, environment } = wallet;
      if (!latestState) return err('InternalError', 'State not available');
      const nid = getEnvironmentConfig(environment).networkId;
      const addr = latestState.unshielded.address;
      return ok({
        unshieldedAddress: addr ? MidnightBech32m.encode(nid, addr).toString() : '',
      });
    }

    case 'getDustAddress': {
      const wallet = requireWallet();
      const { latestState, environment } = wallet;
      if (!latestState) return err('InternalError', 'State not available');
      const nid = getEnvironmentConfig(environment).networkId;
      const pk = latestState.dust.publicKey;
      return ok({
        dustAddress: pk ? DustAddress.encodePublicKey(nid, pk) : '',
      });
    }

    case 'getConfiguration': {
      const { environment } = requireWallet();
      const config = getEnvironmentConfig(environment);
      return ok({
        indexerUri: config.indexerHttpUrl,
        indexerWsUri: config.indexerWsUrl,
        proverServerUri: config.provingServerUrl,
        substrateNodeUri: config.nodeWsUrl,
        networkId: config.networkId,
      });
    }

    case 'getConnectionStatus': {
      const wallet = walletManager.getActiveWallet();
      if (!wallet?.latestState) {
        return ok({ status: 'disconnected' });
      }
      return ok({
        status: 'connected',
        networkId: getEnvironmentConfig(wallet.environment).networkId,
      });
    }

    case 'submitTransaction': {
      const { facade } = requireWallet();
      const txHex = args[0] as string;
      emit('warn', 'tx', 'BYPASS: auto-submitting transaction (production wallet would show confirmation dialog)', { hexLength: txHex.length });
      emit('info', 'tx', 'submitTransaction: deserializing', { hexLength: txHex.length });
      const ledger = await import('@midnight-ntwrk/ledger-v8');
      const txBytes = hexToBytes(txHex);
      const tx = ledger.Transaction.deserialize(
        'signature', 'proof', 'binding', txBytes,
      ) as unknown as ledgerTypes.FinalizedTransaction;
      emit('info', 'tx', 'submitTransaction: submitting to node');
      const submitT0 = Date.now();
      const submittedTxId = await facade.submitTransaction(tx);
      const txHashStr = String(submittedTxId ?? '');
      callContext['txHash'] = txHashStr;
      emit('info', 'tx', 'submitTransaction: submitted', { txHash: txHashStr }, Date.now() - submitT0);
      return ok(txHashStr);
    }

    case 'balanceUnsealedTransaction': {
      const { facade } = requireWallet();
      const txHex = args[0] as string;
      const keys = walletManager.getSecretKeys();
      const keystore = walletManager.getKeystore();
      if (!keys) return err('InternalError', 'Keys not available');

      emit('info', 'tx', 'balanceUnsealed: deserializing', { hexLength: txHex.length });
      const ledger = await import('@midnight-ntwrk/ledger-v8');
      const txBytes = hexToBytes(txHex);
      const tx = ledger.Transaction.deserialize(
        'signature', 'proof', 'pre-binding', txBytes,
      ) as unknown as ledgerTypes.Transaction<
        ledgerTypes.SignatureEnabled, ledgerTypes.Proof, ledgerTypes.PreBinding
      >;

      try {
        const intents = tx.intents;
        const segmentIds = intents ? Array.from(intents.keys()) : [];
        const txInfo: Record<string, unknown> = { segmentIds, intentCount: segmentIds.length };

        const txStr = tx.toString();
        const allHex64 = [...txStr.matchAll(/(?:Deploy|Call|address)[^0-9a-f]*([0-9a-f]{64})/gi)];
        if (allHex64.length > 0) {
          txInfo['contractAddress'] = allHex64[0]![1];
        }
        const addrMatch = txStr.match(/address:\s*"?([0-9a-f]{64})"?/i);
        if (addrMatch && !txInfo['contractAddress']) {
          txInfo['contractAddress'] = addrMatch[1];
        }

        emit('debug', 'tx', 'balanceUnsealed: tx info', txInfo);
      } catch (e) {
        emit('debug', 'tx', 'balanceUnsealed: tx info extraction failed', { error: String(e) });
      }

      emit('info', 'tx', 'balanceUnsealed: balancing');
      await yieldToEventLoop();
      let t = Date.now();
      const recipe = await facade.balanceUnboundTransaction(
        tx, keys, { ttl: new Date(Date.now() + 30 * 60 * 1000) },
      );
      emit('info', 'tx', 'balanceUnsealed: balanced', undefined, Date.now() - t);

      emit('warn', 'tx', 'BYPASS: auto-signing transaction (production wallet would show sign dialog)');
      emit('info', 'tx', 'balanceUnsealed: signing');
      await yieldToEventLoop();
      t = Date.now();
      const signed = keystore
        ? await facade.signRecipe(recipe, (payload) => keystore.signData(payload))
        : recipe;
      emit('info', 'tx', 'balanceUnsealed: signed', undefined, Date.now() - t);

      emit('info', 'tx', 'balanceUnsealed: finalizing (proving)');
      await yieldToEventLoop();
      t = Date.now();
      const finalized = await facade.finalizeRecipe(signed as typeof recipe);
      emit('info', 'tx', 'balanceUnsealed: finalized', undefined, Date.now() - t);

      const txId = String(finalized.identifiers()?.at(-1) ?? '');
      setCallContext('txHash', txId);
      const resultBytes = finalized.serialize();
      emit('info', 'tx', 'balanceUnsealed: done', { txHash: txId, resultHexLength: resultBytes.length * 2 });
      return ok({ tx: bytesToHex(resultBytes) });
    }

    case 'balanceSealedTransaction': {
      const { facade } = requireWallet();
      const txHex = args[0] as string;
      const keys = walletManager.getSecretKeys();
      if (!keys) return err('InternalError', 'Keys not available');

      emit('info', 'tx', 'balanceSealed: deserializing', { hexLength: txHex.length });
      const ledger = await import('@midnight-ntwrk/ledger-v8');
      const txBytes = hexToBytes(txHex);
      const tx = ledger.Transaction.deserialize(
        'signature', 'proof', 'binding', txBytes,
      ) as unknown as ledgerTypes.FinalizedTransaction;

      emit('info', 'tx', 'balanceSealed: balancing');
      await yieldToEventLoop();
      let t = Date.now();
      const recipe = await facade.balanceFinalizedTransaction(
        tx, keys, { ttl: new Date(Date.now() + 30 * 60 * 1000) },
      );
      emit('info', 'tx', 'balanceSealed: balanced', undefined, Date.now() - t);

      emit('info', 'tx', 'balanceSealed: finalizing (proving)');
      await yieldToEventLoop();
      t = Date.now();
      const finalized = await facade.finalizeRecipe(recipe);
      emit('info', 'tx', 'balanceSealed: finalized', undefined, Date.now() - t);

      const sealedTxId = String(finalized.identifiers()?.at(-1) ?? '');
      setCallContext('txHash', sealedTxId);
      const resultBytes = finalized.serialize();
      emit('info', 'tx', 'balanceSealed: done', { txHash: sealedTxId, resultHexLength: resultBytes.length * 2 });
      return ok({ tx: bytesToHex(resultBytes) });
    }

    case 'makeTransfer': {
      const { facade } = requireWallet();
      const desiredOutputs = args[0] as Array<{
        kind: string;
        type: string;
        value: string | bigint;
        recipient: string;
      }>;
      const keys = walletManager.getSecretKeys();
      const keystore = walletManager.getKeystore();
      const networkId = walletManager.getNetworkId();
      if (!keys || !networkId) return err('InternalError', 'Keys not available');

      const addressFormat = await import('@midnight-ntwrk/wallet-sdk-address-format');

      const transfers = desiredOutputs.map((o) => {
        const parsed = addressFormat.MidnightBech32m.parse(o.recipient);
        if (o.kind === 'shielded') {
          return {
            type: 'shielded' as const,
            outputs: [{
              type: o.type,
              receiverAddress: addressFormat.ShieldedAddress.codec.decode(networkId, parsed),
              amount: BigInt(o.value),
            }],
          };
        }
        return {
          type: 'unshielded' as const,
          outputs: [{
            type: o.type,
            receiverAddress: addressFormat.UnshieldedAddress.codec.decode(networkId, parsed),
            amount: BigInt(o.value),
          }],
        };
      });

      emit('info', 'tx', 'makeTransfer: building recipe', { outputCount: desiredOutputs.length });
      await yieldToEventLoop();
      let t = Date.now();
      const recipe = await facade.transferTransaction(transfers, keys, {
        ttl: new Date(Date.now() + 30 * 60 * 1000),
      });
      emit('info', 'tx', 'makeTransfer: recipe built', undefined, Date.now() - t);

      emit('warn', 'tx', 'BYPASS: auto-signing transfer (production wallet would show sign dialog)');
      emit('info', 'tx', 'makeTransfer: signing');
      await yieldToEventLoop();
      t = Date.now();
      const signed = keystore
        ? await facade.signRecipe(recipe, (payload) => keystore.signData(payload))
        : recipe;
      emit('info', 'tx', 'makeTransfer: signed', undefined, Date.now() - t);

      emit('info', 'tx', 'makeTransfer: finalizing (proving)');
      await yieldToEventLoop();
      t = Date.now();
      const finalized = await facade.finalizeRecipe(signed as typeof recipe);
      emit('info', 'tx', 'makeTransfer: finalized', undefined, Date.now() - t);

      const transferTxId = String(finalized.identifiers()?.at(-1) ?? '');
      setCallContext('txHash', transferTxId);
      const resultBytes = finalized.serialize();
      emit('info', 'tx', 'makeTransfer: done', { txHash: transferTxId, resultHexLength: resultBytes.length * 2 });
      return ok({ tx: bytesToHex(resultBytes) });
    }

    case 'signData': {
      const keystore = walletManager.getKeystore();
      if (!keystore) return err('InternalError', 'Keystore not available');
      const data = args[0] as string;
      const options = args[1] as { encoding: string; keyType: string };
      emit('warn', 'tx', 'BYPASS: auto-signing data (production wallet would show data and request approval)', {
        encoding: options.encoding, dataLength: data.length,
      });

      let dataBytes: Uint8Array;
      if (options.encoding === 'hex') {
        dataBytes = hexToBytes(data);
      } else if (options.encoding === 'base64') {
        dataBytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      } else {
        dataBytes = new TextEncoder().encode(data);
      }

      const signature = keystore.signData(dataBytes);
      const publicKey = keystore.getPublicKey();
      return ok({
        data,
        signature: String(signature),
        verifyingKey: String(publicKey),
      });
    }

    case 'getTxHistory':
      return ok([]);

    case 'hintUsage':
      return ok(undefined);

    case 'getProvingProvider':
      return err('InternalError', 'Use proverServerUri from getConfiguration() instead');

    case 'makeIntent':
      return err('InternalError', 'makeIntent not yet implemented');

    default:
      return err('InvalidRequest', `Unknown method: ${method}`);
  }
}
