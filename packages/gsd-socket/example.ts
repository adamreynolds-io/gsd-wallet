/**
 * Deploy a Compact counter contract via GSD Wallet socket.
 *
 * Connects to the wallet, deploys the counter, reads on-chain state,
 * and sends trace events to the wallet's diagnostics panel.
 *
 * Prerequisites:
 *   - GSD Wallet loaded in Chrome, wallet created on localnet (W0)
 *   - Localnet running: npm run localnet:up
 *   - Socket enabled: click the socket icon in the wallet header
 *
 * Run:
 *   cd packages/gsd-socket
 *   ./node_modules/.bin/tsx example.ts
 */
import 'ws';
Object.assign(globalThis, { WebSocket: (await import('ws')).default });

import { GsdConnectServer, waitForExtension } from './src/server.js';
import { GsdWalletConnect } from './src/client.js';
import { createTracer } from './src/tracer.js';

import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { Transaction } from '@midnight-ntwrk/ledger-v8';
import type { FinalizedTransaction } from '@midnight-ntwrk/ledger-v8';

import {
  CompiledCounterContract,
  CompiledCounter,
  CounterPrivateStateId,
  createPrivateState,
  zkConfigPath,
} from './test/fixtures/counter/contract.js';
import type { CounterPrivateState } from './test/fixtures/counter/contract.js';

// --- Hex helpers -------------------------------------------------------------

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// --- Connect to wallet -------------------------------------------------------

const server = new GsdConnectServer({ port: 6372 });
await server.start();
console.log('Listening on ws://127.0.0.1:6372 — enable socket in wallet...');

await waitForExtension(server, 60_000);
console.log('Wallet connected.\n');

const client = new GsdWalletConnect({}, server);
const tracer = createTracer(server);
const log = tracer.scope('example');

await client.connect('undeployed');

// --- Query wallet state (visible in diagnostics as trace events) -------------

const config = await client.getConfiguration();
setNetworkId(config.networkId);
log.info('wallet config', {
  networkId: config.networkId,
  indexer: config.indexerUri,
  prover: config.proverServerUri,
});
console.log(`Network:  ${config.networkId}`);
console.log(`Indexer:  ${config.indexerUri}`);
console.log(`Prover:   ${config.proverServerUri}`);

const dust = await client.getDustBalance();
log.info('dust balance', { cap: dust.cap.toString(), balance: dust.balance.toString() });
console.log(`Dust:     cap=${dust.cap} balance=${dust.balance}\n`);

// --- Build providers ---------------------------------------------------------

const addrs = await client.getShieldedAddresses();

const providers = {
  walletProvider: {
    async balanceTx(tx: { serialize(): Uint8Array }) {
      const txHex = bytesToHex(new Uint8Array(tx.serialize()));
      const { tx: resultHex } = await client.balanceUnsealedTransaction(txHex);
      return Transaction.deserialize(
        'signature', 'proof', 'binding', hexToBytes(resultHex),
      ) as unknown as FinalizedTransaction;
    },
    getCoinPublicKey: () => addrs.shieldedCoinPublicKey,
    getEncryptionPublicKey: () => addrs.shieldedEncryptionPublicKey,
  },
  midnightProvider: {
    async submitTx(tx: { serialize(): Uint8Array }) {
      return client.submitTransaction(bytesToHex(new Uint8Array(tx.serialize())));
    },
  },
  publicDataProvider: indexerPublicDataProvider(config.indexerUri, config.indexerWsUri),
  proofProvider: httpClientProofProvider(
    config.proverServerUri,
    new NodeZkConfigProvider<'increment' | 'decrement' | 'reset'>(zkConfigPath),
  ),
  zkConfigProvider: new NodeZkConfigProvider<'increment' | 'decrement' | 'reset'>(zkConfigPath),
  privateStateProvider: levelPrivateStateProvider<
    typeof CounterPrivateStateId,
    CounterPrivateState
  >({
    privateStateStoreName: `counter-example-${Date.now()}`,
    privateStoragePasswordProvider: () => 'example-password-32-chars-min!!',
    accountId: 'example',
  }),
};

// --- Deploy counter contract -------------------------------------------------

const initialState = createPrivateState(0);
log.info('deploying counter (witness + private state attached)', {
  initialPrivateCounter: initialState.privateCounter,
  circuits: ['increment', 'decrement', 'reset'],
  witness: {
    privateIncrement: 'privateState.privateCounter + 1',
  },
  privateState: initialState,
});
console.log('Deploying counter contract (initial privateCounter=0)...');

const deployed = await deployContract(providers, {
  compiledContract: CompiledCounterContract,
  privateStateId: CounterPrivateStateId,
  initialPrivateState: initialState,
});

const contractAddress = deployed.deployTxData.public.contractAddress;
log.info('deployed', { contractAddress });
console.log(`Contract: ${contractAddress}`);

// --- Read on-chain state -----------------------------------------------------

const state = await providers.publicDataProvider.queryContractState(contractAddress);
if (state) {
  const ledger = CompiledCounter.ledger(state.data);
  const round = Number(ledger.round);
  log.info('on-chain state', { round, contractAddress });
  console.log(`On-chain round: ${round}`);
}

// --- Done --------------------------------------------------------------------

tracer.flush();
await client.disconnect();
await server.stop();
console.log('\nDone. Check the wallet diagnostics panel — filter by "Conn" to see trace events.');
