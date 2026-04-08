/**
 * wallet-api.ts — GSD Wallet Node.js Socket: wallet state query example
 *
 * Demonstrates every read-only API call available through the socket:
 * connection status, configuration URLs, balances, and addresses.
 * Works with any network the wallet is connected to (mainnet, testnet,
 * localnet). Does NOT require a running node or localnet — only the
 * GSD Wallet extension with a wallet already created.
 *
 * Prerequisites:
 *   1. GSD Wallet extension loaded in Chrome (unpacked or from store)
 *   2. A wallet created and unlocked in the extension
 *   3. Node.js Socket enabled: Settings > Node.js Socket > Enable
 *
 * How to run:
 *   cd packages/gsd-socket
 *   npx tsx examples/wallet-api.ts
 *
 * How to see events in the wallet:
 *   Open the GSD Wallet popup > Diagnostics panel.
 *   Filter by "Conn" category to see trace events from this script.
 */

import { GsdConnectServer, waitForExtension } from '../src/server.js';
import { GsdWalletConnect } from '../src/client.js';
import { createTracer } from '../src/tracer.js';
import type { DiagnosticEvent } from '../src/index.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = 6372;
const NETWORK_ID = process.env['NETWORK_ID'] ?? 'mainnet';
const CONNECT_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Display a bigint token amount with a fixed number of decimal places. */
function formatTokenAmount(raw: bigint, decimals = 8): string {
  const divisor = BigInt(10 ** decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return fracStr.length > 0 ? `${whole}.${fracStr}` : `${whole}`;
}

/** Shorten a long hex/bech32 string for display. */
function shorten(addr: string, head = 12, tail = 8): string {
  if (addr.length <= head + tail + 3) return addr;
  return `${addr.slice(0, head)}...${addr.slice(-tail)}`;
}

/** Right-pad a label for aligned two-column output. */
function label(text: string, width = 28): string {
  return text.padEnd(width);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const server = new GsdConnectServer({ port: PORT });
await server.start();

console.log();
console.log(`  Socket server listening on ws://127.0.0.1:${PORT}`);
console.log('  Waiting for GSD Wallet extension to connect...');
console.log('  → Open the GSD Wallet popup > Settings > Node.js Socket > Enable');
console.log();

// Subscribe to diagnostic events FROM the wallet before we connect.
// These are the same events shown in the wallet's own DiagnosticsPanel.
const unsubDiag = server.onDiagnosticEvent((event: DiagnosticEvent) => {
  const elapsed = event.elapsed != null ? ` (${event.elapsed}ms)` : '';
  console.log(
    `  [wallet] ${event.level.padEnd(5)} [${event.category}] ${event.message}${elapsed}`,
  );
});

// Subscribe to state change notifications from the wallet.
const unsubState = server.onStateChange((state: unknown) => {
  if (state && typeof state === 'object' && 'syncStatus' in state) {
    const s = state as { syncStatus?: string };
    console.log(`  [wallet] state update — syncStatus: ${s.syncStatus ?? 'unknown'}`);
  }
});

// Graceful shutdown
let cleanedUp = false;
async function cleanup(): Promise<void> {
  if (cleanedUp) return;
  cleanedUp = true;
  unsubDiag();
  unsubState();
  console.log('\n  Shutting down...');
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
// Set up client and tracer
// ---------------------------------------------------------------------------

const client = new GsdWalletConnect({}, server);
const tracer = createTracer(server);
const log = tracer.scope('wallet-api');

// Announce our presence in the wallet's DiagnosticsPanel
client.emitTrace('info', 'wallet-api example started', { networkId: NETWORK_ID });

// ---------------------------------------------------------------------------
// Connect to the wallet
// ---------------------------------------------------------------------------

log.info(`connecting to wallet`, { networkId: NETWORK_ID });
console.log(`  Connecting to wallet (networkId: ${NETWORK_ID})...`);

try {
  await client.connect(NETWORK_ID);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\n  Failed to connect: ${msg}`);
  console.error('  The wallet may not be initialized, or the networkId may not match.');
  await cleanup();
}

log.info('connected');
console.log('  Connected.\n');

// ---------------------------------------------------------------------------
// Query wallet state
// ---------------------------------------------------------------------------

const results: Record<string, unknown> = {};

// 1. Connection status
console.log('  --- Connection Status ---');
const connStatus = await tracer.span('getConnectionStatus', async () => {
  return client.getConnectionStatus();
});
results['connectionStatus'] = connStatus;
console.log(`  ${label('status')} ${connStatus.status}`);
if (connStatus.networkId) {
  console.log(`  ${label('networkId')} ${connStatus.networkId}`);
}
console.log();

// 2. Configuration (node/indexer/prover URLs)
console.log('  --- Configuration ---');
let config: Awaited<ReturnType<typeof client.getConfiguration>> | null = null;
try {
  config = await tracer.span('getConfiguration', async () => {
    return client.getConfiguration();
  });
  results['configuration'] = config;
  console.log(`  ${label('networkId')} ${config.networkId}`);
  console.log(`  ${label('substrateNodeUri')} ${config.substrateNodeUri}`);
  console.log(`  ${label('indexerUri')} ${config.indexerUri}`);
  console.log(`  ${label('indexerWsUri')} ${config.indexerWsUri}`);
  console.log(`  ${label('proverServerUri')} ${config.proverServerUri}`);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`  (unavailable: ${msg})`);
  log.warn('getConfiguration failed', { error: msg });
}
console.log();

// 3. Shielded balances
console.log('  --- Shielded Balances ---');
try {
  const shielded = await tracer.span('getShieldedBalances', async () => {
    return client.getShieldedBalances();
  });
  results['shieldedBalances'] = shielded;
  const entries = Object.entries(shielded);
  if (entries.length === 0) {
    console.log('  (no shielded tokens)');
  } else {
    for (const [token, amount] of entries) {
      console.log(`  ${label(token)} ${formatTokenAmount(amount)} (raw: ${amount})`);
    }
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`  (unavailable: ${msg})`);
  log.warn('getShieldedBalances failed', { error: msg });
}
console.log();

// 4. Unshielded balances
console.log('  --- Unshielded Balances ---');
try {
  const unshielded = await tracer.span('getUnshieldedBalances', async () => {
    return client.getUnshieldedBalances();
  });
  results['unshieldedBalances'] = unshielded;
  const entries = Object.entries(unshielded);
  if (entries.length === 0) {
    console.log('  (no unshielded tokens)');
  } else {
    for (const [token, amount] of entries) {
      console.log(`  ${label(token)} ${formatTokenAmount(amount)} (raw: ${amount})`);
    }
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`  (unavailable: ${msg})`);
  log.warn('getUnshieldedBalances failed', { error: msg });
}
console.log();

// 5. DUST balance (cap + current balance)
console.log('  --- DUST Balance ---');
try {
  const dust = await tracer.span('getDustBalance', async () => {
    return client.getDustBalance();
  });
  results['dustBalance'] = dust;
  console.log(`  ${label('balance')} ${formatTokenAmount(dust.balance)} tDUST (raw: ${dust.balance})`);
  console.log(`  ${label('cap')} ${formatTokenAmount(dust.cap)} tDUST (raw: ${dust.cap})`);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`  (unavailable: ${msg})`);
  log.warn('getDustBalance failed', { error: msg });
}
console.log();

// 6. Shielded addresses
console.log('  --- Shielded Addresses ---');
try {
  const shieldedAddrs = await tracer.span('getShieldedAddresses', async () => {
    return client.getShieldedAddresses();
  });
  results['shieldedAddresses'] = shieldedAddrs;
  console.log(`  ${label('shieldedAddress')} ${shorten(shieldedAddrs.shieldedAddress)}`);
  console.log(`  ${label('coinPublicKey')} ${shorten(shieldedAddrs.shieldedCoinPublicKey)}`);
  console.log(`  ${label('encryptionPublicKey')} ${shorten(shieldedAddrs.shieldedEncryptionPublicKey)}`);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`  (unavailable: ${msg})`);
  log.warn('getShieldedAddresses failed', { error: msg });
}
console.log();

// 7. Unshielded address
console.log('  --- Unshielded Address ---');
try {
  const unshieldedAddr = await tracer.span('getUnshieldedAddress', async () => {
    return client.getUnshieldedAddress();
  });
  results['unshieldedAddress'] = unshieldedAddr;
  console.log(`  ${label('unshieldedAddress')} ${shorten(unshieldedAddr.unshieldedAddress)}`);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`  (unavailable: ${msg})`);
  log.warn('getUnshieldedAddress failed', { error: msg });
}
console.log();

// 8. DUST address
console.log('  --- DUST Address ---');
try {
  const dustAddr = await tracer.span('getDustAddress', async () => {
    return client.getDustAddress();
  });
  results['dustAddress'] = dustAddr;
  console.log(`  ${label('dustAddress')} ${shorten(dustAddr.dustAddress)}`);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`  (unavailable: ${msg})`);
  log.warn('getDustAddress failed', { error: msg });
}
console.log();

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

client.emitTrace('info', 'wallet-api example complete', { queriesRun: Object.keys(results).length });
tracer.flush();

console.log('  ='.repeat(36));
console.log('  Summary');
console.log('  ='.repeat(36));
console.log(`  Network:   ${NETWORK_ID}`);
console.log(`  Queries:   ${Object.keys(results).length} completed`);
console.log(`  Trace:     Check DiagnosticsPanel > "Conn" category in wallet popup`);
console.log();
console.log('  Press Ctrl+C to stop the socket server.');

// Keep running so the extension stays connected and events can be observed.
// The onStateChange and onDiagnosticEvent subscriptions above will continue
// logging any updates that arrive while we're idle.
