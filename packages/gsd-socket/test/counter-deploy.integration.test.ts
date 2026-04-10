/**
 * Counter contract integration test — requires a live GSD Wallet extension connection.
 *
 * Prerequisites:
 *   - GSD Wallet Chrome extension running and connected to localnet
 *   - Localnet services: indexer (port 8088), proof server (port 6300)
 *   - Wallet funded with dust and shielded tokens
 *
 * Run: npm run test:integration
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
// WebSocket polyfill is in test/setup-ws.ts (vitest setupFiles) —
// must run before SDK imports to avoid Apollo caching undefined.

import { GsdConnectServer, waitForExtension } from '../src/server.js';
import { GsdWalletConnect } from '../src/client.js';
import { createTracer } from '../src/tracer.js';
import type { ConnectTracer } from '../src/tracer.js';

import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { Transaction } from '@midnight-ntwrk/ledger-v8';
import type {
  FinalizedTransaction,
  ContractAddress,
} from '@midnight-ntwrk/ledger-v8';
import type {
  MidnightProviders,
  WalletProvider,
  MidnightProvider,
} from '@midnight-ntwrk/midnight-js-types';

import {
  CompiledCounterContract,
  CompiledCounter,
  CounterPrivateStateId,
  createPrivateState,
  zkConfigPath,
} from './fixtures/counter/contract.js';
import type { CounterPrivateState } from './fixtures/counter/contract.js';

// --- Configuration -----------------------------------------------------------

const PORT = 6372;
const INDEXER_URL = 'http://127.0.0.1:8088/api/v4/graphql';
const INDEXER_WS = 'ws://127.0.0.1:8088/api/v4/graphql/ws';
const PROOF_SERVER = 'http://127.0.0.1:6300';
const EXTENSION_TIMEOUT_MS = 60_000;

type CounterCircuit = 'increment' | 'decrement' | 'reset';
type CounterProviders = MidnightProviders<
  CounterCircuit,
  typeof CounterPrivateStateId,
  CounterPrivateState
>;

// --- Utilities ---------------------------------------------------------------

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

async function buildWalletProvider(client: GsdWalletConnect): Promise<WalletProvider> {
  // Prefetch keys upfront so synchronous getters can return them immediately.
  // CoinPublicKey and EncPublicKey are plain strings in @midnight-ntwrk/ledger-v8.
  const addrs = await client.getShieldedAddresses();
  const coinPublicKey = addrs.shieldedCoinPublicKey;
  const encPublicKey = addrs.shieldedEncryptionPublicKey;

  return {
    async balanceTx(tx, _ttl) {
      const txHex = bytesToHex(new Uint8Array(tx.serialize()));
      const { tx: resultHex } = await client.balanceUnsealedTransaction(txHex);
      return Transaction.deserialize(
        'signature',
        'proof',
        'binding',
        hexToBytes(resultHex),
      ) as unknown as FinalizedTransaction;
    },
    getCoinPublicKey: () => coinPublicKey,
    getEncryptionPublicKey: () => encPublicKey,
  };
}

function buildMidnightProvider(client: GsdWalletConnect): MidnightProvider {
  return {
    async submitTx(tx) {
      const txHex = bytesToHex(new Uint8Array(tx.serialize()));
      const txId = await client.submitTransaction(txHex);
      return txId;
    },
  };
}

// --- Test suite --------------------------------------------------------------

describe('Counter contract via GSD Wallet socket', () => {
  let server: GsdConnectServer;
  let client: GsdWalletConnect;
  let tracer: ConnectTracer;
  let log: ConnectTracer;
  let providers: CounterProviders;
  let contractAddress: ContractAddress;

  beforeAll(async () => {
    server = new GsdConnectServer({ port: PORT });
    await server.start();

    console.log(`  Connect server listening on ws://127.0.0.1:${PORT}`);
    console.log('  Waiting for GSD Wallet extension to connect...');

    await waitForExtension(server, EXTENSION_TIMEOUT_MS);
    console.log('  Extension connected.');

    client = new GsdWalletConnect({}, server);
    tracer = createTracer(server);
    log = tracer.scope('counter-test');

    // Get the wallet's actual network config before connecting.
    // The wallet returns the correct networkId for its environment —
    // using this instead of hardcoding avoids "invalid tx" rejections
    // when the node's network ID doesn't match a hardcoded string.
    //
    // Note: getConfiguration() doesn't require a session — but our
    // protocol does. Connect first with a provisional networkId, then
    // read the real config. The wallet doesn't enforce the connect
    // networkId; it just creates a session.
    log.info('connecting to wallet');
    await client.connect('undeployed');

    const cfg = await client.getConfiguration();
    const networkId = cfg.networkId;
    log.info('wallet configuration', {
      networkId,
      indexer: cfg.indexerUri,
      prover: cfg.proverServerUri,
      node: cfg.substrateNodeUri,
    });

    // Set the SDK-global network ID to match the wallet's network
    setNetworkId(networkId);
    console.log(`  Network ID: ${networkId}`);

    const status = await client.getConnectionStatus();
    expect(status.status).toBe('connected');
    log.info('wallet connected', { status: status.status, networkId });

    const dust = await client.getDustBalance();
    expect(dust.balance).toBeGreaterThan(0n);
    log.info('dust balance', { balance: dust.balance.toString() });
    console.log(`  Dust balance: ${dust.balance.toString()}`);

    const indexerUrl = cfg.indexerUri ?? INDEXER_URL;
    const indexerWsUrl = cfg.indexerWsUri ?? INDEXER_WS;
    const proofServerUrl = cfg.proverServerUri ?? PROOF_SERVER;

    const walletProvider = await buildWalletProvider(client);
    const midnightProvider = buildMidnightProvider(client);
    const zkConfigProvider = new NodeZkConfigProvider<CounterCircuit>(zkConfigPath);

    providers = {
      walletProvider,
      midnightProvider,
      publicDataProvider: indexerPublicDataProvider(indexerUrl, indexerWsUrl),
      proofProvider: httpClientProofProvider(proofServerUrl, zkConfigProvider),
      zkConfigProvider,
      privateStateProvider: levelPrivateStateProvider({
        privateStateStoreName: `gsd-counter-${Date.now()}`,
        privateStoragePasswordProvider: () => 'integration-test-password-32chars!',
        accountId: 'integration-test',
      }),
    };
  }, 5 * 60_000);

  afterAll(async () => {
    log?.info('test suite complete');
    tracer?.flush();
    await client?.close();
    await server?.stop();
  });

  test('deploy counter contract', async () => {
    try {
      const deployed = await tracer.span('deploy-counter', async () => {
        log.info('deploying counter contract');
        return deployContract(providers, {
          compiledContract: CompiledCounterContract,
          privateStateId: CounterPrivateStateId,
          initialPrivateState: createPrivateState(0),
        });
      });

      contractAddress = deployed.deployTxData.public.contractAddress;
      expect(contractAddress).toBeTruthy();
      log.info('contract deployed', { contractAddress });
      console.log(`  Contract deployed at: ${contractAddress}`);
    } catch (err) {
      const e = err as Error & { code?: string; cause?: unknown };
      console.error('  Deploy failed:', e.message);
      console.error('  Error code:', e.code);
      console.error('  Cause:', e.cause);
      console.error('  Stack:', e.stack);
      log.error('deploy failed', {
        message: e.message,
        code: e.code,
        cause: String(e.cause ?? ''),
      });
      throw err;
    }
  }, 5 * 60_000);

  test('call increment', async () => {
    const result = await tracer.span('increment-1', async () => {
      log.info('calling increment', { contractAddress });
      return submitCallTx(providers, {
        compiledContract: CompiledCounterContract,
        contractAddress,
        circuitId: 'increment' as const,
        privateStateId: CounterPrivateStateId,
      });
    });

    log.info('increment completed', { status: result.public.status });
    expect(result.public.status).toBe('SucceedEntirely');
  }, 5 * 60_000);

  test('call increment again and verify on-chain state', async () => {
    const result = await tracer.span('increment-2', async () => {
      log.info('calling increment again', { contractAddress });
      return submitCallTx(providers, {
        compiledContract: CompiledCounterContract,
        contractAddress,
        circuitId: 'increment' as const,
        privateStateId: CounterPrivateStateId,
      });
    });

    log.info('second increment completed', { status: result.public.status });
    expect(result.public.status).toBe('SucceedEntirely');

    const contractState = await providers.publicDataProvider.queryContractState(contractAddress);
    if (contractState) {
      const ledger = CompiledCounter.ledger(contractState.data);
      expect(Number(ledger.round)).toBe(2);
      log.info('on-chain state verified', { round: Number(ledger.round) });
      console.log(`  Ledger round after 2 increments: ${ledger.round.toString()}`);
    }
  }, 5 * 60_000);
});
