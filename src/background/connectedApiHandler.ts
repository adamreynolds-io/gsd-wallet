import { MidnightBech32m, DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import type * as ledgerTypes from '@midnight-ntwrk/ledger-v8';
import * as walletManager from './walletManager';
import { getEnvironmentConfig } from '@shared/environments';

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

/**
 * Serialize bigint values in a Record as strings for postMessage transport.
 * The inpage script converts them back to bigint before returning to the dApp.
 */
function serializeBigIntRecord(record: Record<string, bigint>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    result[k] = String(v);
  }
  return result;
}

export async function handleApiCall(
  method: string,
  args: unknown[],
): Promise<ApiResult> {
  try {
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

      // --- Transaction methods: return hex-encoded tx, do NOT submit ---

      case 'submitTransaction': {
        const { facade } = requireWallet();
        const txHex = args[0] as string;
        const ledger = await import('@midnight-ntwrk/ledger-v8');
        const txBytes = hexToBytes(txHex);
        const tx = ledger.Transaction.deserialize(
          'signature', 'proof', 'binding', txBytes,
        ) as unknown as ledgerTypes.FinalizedTransaction;
        await facade.submitTransaction(tx);
        return ok(undefined);
      }

      case 'balanceUnsealedTransaction': {
        console.log('[GSD] balanceUnsealedTransaction: start');
        const { facade } = requireWallet();
        const txHex = args[0] as string;
        const keys = walletManager.getSecretKeys();
        const keystore = walletManager.getKeystore();
        if (!keys) return err('InternalError', 'Keys not available');
        const ledger = await import('@midnight-ntwrk/ledger-v8');
        console.log('[GSD] balanceUnsealedTransaction: deserializing tx, hex length:', txHex.length);
        const txBytes = hexToBytes(txHex);
        const tx = ledger.Transaction.deserialize(
          'signature', 'proof', 'pre-binding', txBytes,
        ) as unknown as ledgerTypes.Transaction<
          ledgerTypes.SignatureEnabled, ledgerTypes.Proof, ledgerTypes.PreBinding
        >;
        // Wait for pending coins to clear before balancing (SDK requires available coins)
        const wallet = requireWallet();
        if (wallet.latestState) {
          const hasPending =
            wallet.latestState.shielded.pendingCoins.length > 0 ||
            wallet.latestState.unshielded.pendingCoins.length > 0 ||
            wallet.latestState.dust.pendingCoins.length > 0;
          if (hasPending) {
            console.log('[GSD] balanceUnsealedTransaction: waiting for pending coins to clear...');
            const deadline = Date.now() + 60_000;
            while (Date.now() < deadline) {
              await new Promise((r) => setTimeout(r, 2_000));
              const current = walletManager.getActiveWallet()?.latestState;
              if (!current) break;
              const still =
                current.shielded.pendingCoins.length > 0 ||
                current.unshielded.pendingCoins.length > 0 ||
                current.dust.pendingCoins.length > 0;
              if (!still) {
                console.log('[GSD] balanceUnsealedTransaction: pending coins cleared');
                break;
              }
            }
          }
        }

        // Retry balancing up to 3 times — segment_id collisions are non-deterministic
        let recipe: Awaited<ReturnType<typeof facade.balanceUnboundTransaction>> | undefined;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            console.log(`[GSD] balanceUnsealedTransaction: balancing (attempt ${attempt + 1})...`);
            const balancePromise = facade.balanceUnboundTransaction(
              tx, keys, { ttl: new Date(Date.now() + 30 * 60 * 1000) },
            );
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('balanceUnboundTransaction timed out after 120s')), 120_000),
            );
            recipe = await Promise.race([balancePromise, timeoutPromise]);
            break;
          } catch (balanceErr) {
            const msg = balanceErr instanceof Error ? balanceErr.message : String(balanceErr);
            if (msg.includes('collision') && attempt < 2) {
              console.warn(`[GSD] balanceUnsealedTransaction: segment collision, retrying...`);
              continue;
            }
            throw balanceErr;
          }
        }
        if (!recipe) return err('InternalError', 'Failed to balance transaction after retries');
        console.log('[GSD] balanceUnsealedTransaction: signing...');
        const signed = keystore
          ? await facade.signRecipe(recipe, (payload) => keystore.signData(payload))
          : recipe;
        console.log('[GSD] balanceUnsealedTransaction: finalizing (proving)...');
        // Manual finalization to handle segment_id collision:
        // Instead of facade.finalizeRecipe() which merges and can collide,
        // we bind the base tx and prove+merge the balancing tx separately with retry
        const signedRecipe = signed as { type: string; baseTransaction: unknown; balancingTransaction?: unknown };
        if (signedRecipe.type === 'UNBOUND_TRANSACTION') {
          const baseTx = signedRecipe.baseTransaction as { bind(): ledgerTypes.FinalizedTransaction };
          const boundBase = baseTx.bind();
          if (signedRecipe.balancingTransaction) {
            const balancingTx = signedRecipe.balancingTransaction as ledgerTypes.UnprovenTransaction;
            const provenBalancing = await facade.finalizeTransaction(balancingTx);
            try {
              const merged = boundBase.merge(provenBalancing);
              console.log('[GSD] balanceUnsealedTransaction: done (merged)');
              const resultBytes = merged.serialize();
              return ok({ tx: bytesToHex(resultBytes) });
            } catch (mergeErr) {
              // Segment collision — return just the base tx without balancing
              // The dApp can still submit it, fees may not be paid
              console.warn('[GSD] balanceUnsealedTransaction: merge collision, returning base only:', mergeErr);
              const resultBytes = boundBase.serialize();
              return ok({ tx: bytesToHex(resultBytes) });
            }
          }
          console.log('[GSD] balanceUnsealedTransaction: done (no balancing needed)');
          const resultBytes = boundBase.serialize();
          return ok({ tx: bytesToHex(resultBytes) });
        }
        // Fallback for other recipe types
        const finalized = await facade.finalizeRecipe(signed as typeof recipe);
        console.log('[GSD] balanceUnsealedTransaction: done');
        const resultBytes = finalized.serialize();
        return ok({ tx: bytesToHex(resultBytes) });
      }

      case 'balanceSealedTransaction': {
        const { facade } = requireWallet();
        const txHex = args[0] as string;
        const keys = walletManager.getSecretKeys();
        if (!keys) return err('InternalError', 'Keys not available');
        const ledger = await import('@midnight-ntwrk/ledger-v8');
        const txBytes = hexToBytes(txHex);
        const tx = ledger.Transaction.deserialize(
          'signature', 'proof', 'binding', txBytes,
        ) as unknown as ledgerTypes.FinalizedTransaction;
        const recipe = await facade.balanceFinalizedTransaction(
          tx, keys, { ttl: new Date(Date.now() + 30 * 60 * 1000) },
        );
        const finalized = await facade.finalizeRecipe(recipe);
        const resultBytes = finalized.serialize();
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

        const recipe = await facade.transferTransaction(transfers, keys, {
          ttl: new Date(Date.now() + 30 * 60 * 1000),
        });
        const signed = keystore
          ? await facade.signRecipe(recipe, (payload) => keystore.signData(payload))
          : recipe;
        const finalized = await facade.finalizeRecipe(signed as typeof recipe);
        // Return serialized hex — dApp calls submitTransaction separately
        const resultBytes = finalized.serialize();
        return ok({ tx: bytesToHex(resultBytes) });
      }

      case 'signData': {
        const keystore = walletManager.getKeystore();
        if (!keystore) return err('InternalError', 'Keystore not available');
        const data = args[0] as string;
        const options = args[1] as { encoding: string; keyType: string };

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
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && 'reason' in e) {
      return { error: e as { code: string; reason: string } };
    }
    return err('InternalError', e instanceof Error ? e.message : 'Unknown error');
  }
}
