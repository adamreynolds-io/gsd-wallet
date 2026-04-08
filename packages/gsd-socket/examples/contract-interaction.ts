/**
 * contract-interaction.ts — GSD Wallet Node.js Socket: dApp / test harness template
 *
 * A documented template showing how to use the socket in a dApp or test
 * harness to build, prove, balance, and submit a contract transaction.
 *
 * Uses the @midnight-ntwrk/midnight-js barrel package (4.0.2+) for imports.
 * Provider packages (proof, indexer, private state) still need individual installs.
 *
 * The actual contract calls use pseudocode comments because they require
 * specific contract build artifacts (compiled Compact circuits, a running
 * proof server). Everything that touches the socket itself is real, working code.
 *
 * Dependencies:
 *   npm install @midnight-ntwrk/midnight-js                              # barrel: contracts, types, network-id, utils
 *   npm install @midnight-ntwrk/midnight-js-http-client-proof-provider   # proving
 *   npm install @midnight-ntwrk/midnight-js-indexer-public-data-provider # indexer
 *   npm install @midnight-ntwrk/midnight-js-level-private-state-provider # private state (LevelDB)
 *   npm install @midnight-ntwrk/midnight-js-node-zk-config-provider      # ZK config (Node.js filesystem)
 *   npm install gsd-wallet-connect                                         # this package
 *
 * Prerequisites:
 *   1. GSD Wallet extension loaded in Chrome (unpacked or from store)
 *   2. A wallet created and unlocked in the extension
 *   3. Node.js Socket enabled: Settings > Node.js Socket > Enable
 *   4. For the contract steps: a deployed contract and running proof server
 *
 * How to run:
 *   cd packages/gsd-socket
 *   npm run build
 *   npx tsx examples/contract-interaction.ts
 *
 * How to adapt:
 *   1. Replace CONTRACT_ADDRESS with your deployed contract address
 *   2. Replace the pseudocode sections marked "REPLACE WITH REAL CONTRACT CODE"
 *      with calls from your @midnight-ntwrk/midnight-js-contracts build
 *   3. Set env vars: NETWORK_ID, CONTRACT_ADDRESS, PROVER_URL
 */

import {
  GsdConnectServer,
  GsdWalletConnect,
  createTracer,
  createProviders,
  createWalletProvider,
  createMidnightProvider,
  waitForExtension,
} from 'gsd-wallet-connect';
import type {
  GsdWalletProvider,
  GsdMidnightProvider,
  DiagnosticEvent,
} from 'gsd-wallet-connect';

// ---------------------------------------------------------------------------
// Configuration — override via environment variables
// ---------------------------------------------------------------------------

const PORT = 6372;
const NETWORK_ID = process.env['NETWORK_ID'] ?? 'testnet-02';
const CONTRACT_ADDRESS = process.env['CONTRACT_ADDRESS'] ?? '';
const CONNECT_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Connect infrastructure setup
// ---------------------------------------------------------------------------

// 1. Start the WebSocket server. The extension connects to this.
const server = new GsdConnectServer({ port: PORT });
await server.start();

console.log();
console.log(`  Socket listening on ws://127.0.0.1:${PORT}`);
console.log('  Waiting for GSD Wallet extension...');
console.log('  → Open the GSD Wallet popup > Settings > Node.js Socket > Enable');
console.log();

// ---------------------------------------------------------------------------
// Subscribe to wallet events BEFORE connecting.
// This captures diagnostic events from sync, proving, and submission,
// which is valuable for debugging both the wallet and your contract.
// ---------------------------------------------------------------------------

// Wallet's own diagnostic stream — same events as the DiagnosticsPanel.
// Filter on event.category for focused debugging:
//   'sync'    — blockchain sync progress
//   'tx'      — transaction lifecycle
//   'wallet'  — wallet state changes
//   'error'   — any wallet-side error
const unsubDiag = server.onDiagnosticEvent((event: DiagnosticEvent) => {
  // Only print warnings and errors to avoid noise; remove the filter to see all.
  if (event.level === 'warn' || event.level === 'error') {
    const elapsed = event.elapsed != null ? ` (${event.elapsed}ms)` : '';
    console.log(
      `  [wallet/${event.category}] ${event.level}: ${event.message}${elapsed}`,
    );
  }
});

// Wallet state changes — fires when sync status, balances, etc. change.
// Useful in long-running harnesses to know when the wallet is ready.
const unsubState = server.onStateChange((state: unknown) => {
  if (state && typeof state === 'object' && 'syncStatus' in state) {
    const s = state as { syncStatus?: string };
    console.log(`  [wallet] syncStatus changed: ${s.syncStatus ?? 'unknown'}`);
  }
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

let cleanedUp = false;
async function cleanup(): Promise<void> {
  if (cleanedUp) return;
  cleanedUp = true;
  unsubDiag();
  unsubState();
  console.log('\n  Shutting down socket...');
  await server.stop();
  process.exit(0);
}
process.on('SIGINT', () => void cleanup());

// ---------------------------------------------------------------------------
// Wait for extension connection
// ---------------------------------------------------------------------------

try {
  await waitForExtension(server, CONNECT_TIMEOUT_MS);
} catch (err) {
  console.error(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`);
  await server.stop();
  process.exit(1);
}

console.log('  GSD Wallet extension connected.\n');

// ---------------------------------------------------------------------------
// Create the connect client and tracer
// ---------------------------------------------------------------------------

// GsdWalletConnect wraps the server and provides the typed API.
// Pass the existing server instance so it shares the same WebSocket connection.
const client = new GsdWalletConnect({}, server);

// createTracer batches trace events and sends them to the wallet's
// DiagnosticsPanel under the "Conn" (socket) category.
// Use tracer.scope(name) to create named child tracers for each subsystem.
const tracer = createTracer(server);
const log = tracer.scope('contract-interaction');

log.info('example started', { networkId: NETWORK_ID });

// ---------------------------------------------------------------------------
// Step 1: Connect to the wallet
// ---------------------------------------------------------------------------
//
// connect() creates a session with the wallet for the given networkId.
// The wallet will reject API calls if the networkId does not match the
// wallet's currently active network.
// ---------------------------------------------------------------------------

console.log(`  [1/5] Connecting to wallet (networkId: ${NETWORK_ID})...`);

try {
  await tracer.span('connect', async () => {
    await client.connect(NETWORK_ID);
  });
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  log.error('connect failed', { error: msg });
  console.error(`\n  Failed to connect: ${msg}`);
  console.error('  Check that the wallet is initialized and on the correct network.');
  await cleanup();
}

console.log('  Connected.');

// ---------------------------------------------------------------------------
// Step 2: Verify the wallet is ready
// ---------------------------------------------------------------------------
//
// Check connection status and confirm the wallet is synced before submitting
// any transactions. A wallet that is still syncing may balance incorrectly.
// ---------------------------------------------------------------------------

console.log('  [2/5] Verifying wallet state...');

const connStatus = await tracer.span('getConnectionStatus', async () => {
  return client.getConnectionStatus();
});
log.info('connection status', connStatus);

if (connStatus.status !== 'connected') {
  log.warn('wallet not fully connected', { status: connStatus.status });
  console.log(`  Warning: wallet status is "${connStatus.status}" — proceeding anyway.`);
}

// ---------------------------------------------------------------------------
// Step 3: Get configuration for building providers
// ---------------------------------------------------------------------------
//
// getConfiguration() returns the URLs your dApp needs to connect to the node,
// indexer, and proof server. Use these instead of hardcoding URLs so the
// example works on any network the wallet is configured for.
// ---------------------------------------------------------------------------

console.log('  [3/5] Fetching wallet configuration...');

let walletConfig: Awaited<ReturnType<typeof client.getConfiguration>> | null = null;
try {
  walletConfig = await tracer.span('getConfiguration', async () => {
    return client.getConfiguration();
  });
  log.info('configuration', walletConfig);
  console.log(`  Indexer:      ${walletConfig.indexerUri}`);
  console.log(`  Prover:       ${walletConfig.proverServerUri}`);
  console.log(`  Node:         ${walletConfig.substrateNodeUri}`);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  log.warn('getConfiguration failed', { error: msg });
  console.log(`  Configuration unavailable: ${msg}`);
}

// ---------------------------------------------------------------------------
// Step 4: Create providers
// ---------------------------------------------------------------------------
//
// The client provides two midnight-js-compatible providers:
//
//   walletProvider  — implements WalletProvider from @midnight-ntwrk/midnight-js-types
//                     balanceTx() calls client.balanceUnsealedTransaction()
//                     getCoinPublicKey() / getEncryptionPublicKey() come from
//                     client.getShieldedAddresses()
//
//   midnightProvider — implements MidnightProvider
//                      submitTx() calls client.submitTransaction()
//
// You can create them individually or as a pair:
// ---------------------------------------------------------------------------

console.log('  [4/5] Creating providers...');

// Option A: create both at once (most common)
const { walletProvider, midnightProvider } = createProviders(client);
log.info('providers created');

// Option B: create individually (useful when you need to inject them separately)
const walletProviderAlt: GsdWalletProvider = createWalletProvider(client);
const midnightProviderAlt: GsdMidnightProvider = createMidnightProvider(client);

// Silence unused variable warnings for the template
void walletProviderAlt;
void midnightProviderAlt;

// ---------------------------------------------------------------------------
// Step 5: Build, prove, balance, and submit a contract transaction
// ---------------------------------------------------------------------------
//
// This section shows the full transaction lifecycle. The contract-specific
// parts (contract deployment, circuit instantiation, proof generation) are
// pseudocode. Replace them with your actual @midnight-ntwrk/midnight-js-contracts
// calls. The socket calls (balance, submit) are real working code.
//
// Typical flow:
//   a. Build an unproven (unsealed) transaction using the contract SDK
//   b. Prove it against the proof server
//   c. Balance it via the wallet (adds DUST inputs/outputs for fees)
//   d. Submit it through the wallet
// ---------------------------------------------------------------------------

console.log('  [5/5] Transaction lifecycle demo...');

if (!CONTRACT_ADDRESS) {
  console.log();
  console.log('  CONTRACT_ADDRESS not set — showing pattern only (no real call).');
  console.log('  Set env var CONTRACT_ADDRESS to a deployed contract to try for real.');
  console.log();
}

try {
  // ------------------------------------------------------------------
  // REPLACE WITH REAL CONTRACT CODE: build an unproven transaction
  // ------------------------------------------------------------------
  //
  // With the @midnight-ntwrk/midnight-js barrel package (4.0.2+):
  //
  //   import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js/contracts';
  //   import { setNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
  //   import type { MidnightProviders } from '@midnight-ntwrk/midnight-js/types';
  //
  //   // Provider packages are still imported individually:
  //   import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
  //   import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
  //   import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
  //   import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
  //
  //   // Assemble providers — walletProvider and midnightProvider come from the socket:
  //   const providers: MidnightProviders = {
  //     walletProvider,
  //     midnightProvider,
  //     publicDataProvider: indexerPublicDataProvider(config.indexerUri, config.indexerWsUri),
  //     proofProvider: httpClientProofProvider(config.proverServerUri),
  //     zkConfigProvider: new NodeZkConfigProvider(zkConfigPath),
  //     privateStateProvider: levelPrivateStateProvider({ privateStateStoreName: 'my-dapp' }),
  //   };
  //
  //   // Deploy a contract:
  //   const deployed = await deployContract(providers, { compiledContract: MyContract });
  //
  //   // Or find an existing deployment:
  //   const found = await findDeployedContract(providers, {
  //     contractAddress: CONTRACT_ADDRESS,
  //     compiledContract: MyContract,
  //   });
  //
  // For this template we create a minimal placeholder:

  const contractLog = log.scope('contract');
  contractLog.info('building transaction', { contract: CONTRACT_ADDRESS || 'placeholder' });

  // ------------------------------------------------------------------
  // REPLACE WITH REAL CONTRACT CODE: prove the transaction
  // ------------------------------------------------------------------
  //
  // With deployContract / submitCallTx from the barrel package, proving
  // is handled automatically via the proofProvider in your MidnightProviders.
  //
  // If you need manual control (e.g. decomposed prove-then-balance flow):
  //
  //   import { createUnprovenCallTx } from '@midnight-ntwrk/midnight-js/contracts';
  //   import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
  //
  //   const unproven = createUnprovenCallTx(providers, { contractAddress, circuitId, args });
  //   const proved = await providers.proofProvider.proveTx(unproven);
  //   const provedHex = Buffer.from(proved.serialize()).toString('hex');
  //
  //   // Then balance and submit via the socket:
  //   const { tx: balancedHex } = await client.balanceUnsealedTransaction(provedHex);
  //   await client.submitTransaction(balancedHex);
  //
  const proofLog = log.scope('proving');

  const provedTxHex = await tracer.span('prove-transaction', async () => {
    proofLog.info('starting proof', { proverUri: walletConfig?.proverServerUri ?? 'unknown' });

    // TODO: Replace this placeholder with your actual prove() call.
    // Example:
    //   const unproven = createUnprovenCallTx(providers, { contractAddress, circuitId, args });
    //   const proved = await providers.proofProvider.proveTx(unproven);
    //   return Buffer.from(proved.serialize()).toString('hex');

    const placeholderTxHex = '00'.repeat(64);
    if (CONTRACT_ADDRESS) {
      proofLog.warn('using placeholder proof — replace with real prove() call');
    } else {
      proofLog.info('proof complete (placeholder)', { txHex: placeholderTxHex.slice(0, 16) + '...' });
    }
    return placeholderTxHex;
  });

  // ------------------------------------------------------------------
  // Balance the proved transaction via the GSD wallet
  // ------------------------------------------------------------------
  //
  // balanceUnsealedTransaction() asks the wallet to:
  //   - Add DUST coin inputs to cover fees
  //   - Add a DUST change output if needed
  //   - Return the balanced (but still unsealed) transaction hex
  //
  // The wallet uses the session's networkId to resolve coin UTXOs.
  // Call this AFTER proving so the fee inputs reference valid proofs.
  //
  // Options:
  //   payFees: true  — wallet pays fees from its DUST balance (default)
  //   payFees: false — caller is responsible for fee inputs (advanced)
  //
  // There is also balanceSealedTransaction() for transactions that have
  // already been sealed (rare — use balanceUnsealedTransaction by default).

  const balanceLog = log.scope('balancing');

  if (CONTRACT_ADDRESS) {
    balanceLog.info('balancing transaction');
    const balanced = await tracer.span('balanceUnsealedTransaction', async () => {
      return client.balanceUnsealedTransaction(provedTxHex, { payFees: true });
    });
    balanceLog.info('balanced', { txHex: balanced.tx.slice(0, 16) + '...' });

    // ------------------------------------------------------------------
    // Submit the balanced transaction via the GSD wallet
    // ------------------------------------------------------------------
    //
    // submitTransaction() sends the balanced transaction to the node.
    // The wallet signs it with the user's key before broadcasting.
    // This will prompt the user for confirmation in the extension popup
    // (depending on wallet settings).
    //
    // On success: resolves void — there is no txHash return value.
    // On failure: throws with an error code and reason string.

    const submitLog = log.scope('submission');
    submitLog.info('submitting transaction');

    await tracer.span('submitTransaction', async () => {
      await client.submitTransaction(balanced.tx);
    });

    submitLog.info('submitted');
    console.log('  Transaction submitted successfully.');
  } else {
    // Show what the balance and submit calls look like without running them.
    console.log();
    console.log('  Pattern (not executed — no CONTRACT_ADDRESS):');
    console.log();
    console.log('    // Balance the proved transaction:');
    console.log('    const { tx: balancedHex } = await client.balanceUnsealedTransaction(');
    console.log('      provedTxHex,');
    console.log('      { payFees: true },');
    console.log('    );');
    console.log();
    console.log('    // Submit via the wallet (wallet signs and broadcasts):');
    console.log('    await client.submitTransaction(balancedHex);');
    console.log();
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes('not initialized') || msg.includes('wallet')) {
    console.log(`\n  Wallet error: ${msg}`);
    console.log('  Make sure the wallet is fully synced before submitting transactions.');
  } else if (msg.includes('proof') || msg.includes('prover')) {
    console.log(`\n  Proof server error: ${msg}`);
    console.log(`  Check that the proof server is running at ${walletConfig?.proverServerUri ?? 'the configured URL'}.`);
  } else {
    console.log(`\n  Transaction error: ${msg}`);
  }

  log.warn('transaction lifecycle stopped', { error: msg });
}

// ---------------------------------------------------------------------------
// Additional API patterns
// ---------------------------------------------------------------------------

// makeTransfer — build a token transfer without a contract
// Useful for testing that the wallet can balance and submit before you
// wire up contract-specific logic.
//
// const { tx: transferTx } = await client.makeTransfer([
//   {
//     kind: 'shielded',
//     type: 'dust',
//     value: '1000000000',  // 10 tDUST in raw units (8 decimals)
//     recipient: recipientShieldedAddress,
//   },
// ]);
// await client.submitTransaction(transferTx);

// signData — sign arbitrary data for off-chain authentication
//
// const signed = await client.signData(
//   Buffer.from('hello world').toString('hex'),
//   { encoding: 'hex', keyType: 'coin' },
// );
// console.log('signature:', signed.signature);
// console.log('verifying key:', signed.verifyingKey);

// getTxHistory — paginated transaction history
//
// const page0 = await client.getTxHistory(0, 50);
// console.log(`${page0.length} transactions on page 0`);

// hintUsage — tell the wallet which methods you plan to call next.
// The wallet uses this to pre-fetch data, improving responsiveness.
//
// await client.hintUsage(['getShieldedBalances', 'getShieldedAddresses']);

// ---------------------------------------------------------------------------
// Wrap up
// ---------------------------------------------------------------------------

tracer.flush();
log.info('example complete');

console.log();
console.log('  Template complete. Adapt the contract steps above for your use case.');
console.log('  Press Ctrl+C to stop the socket server.');
console.log();

// Keep the socket running so the extension stays connected.
// In a real test harness you would call cleanup() after the test suite finishes.
