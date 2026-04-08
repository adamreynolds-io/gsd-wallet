/**
 * Demo script — start this, then connect GSD Wallet extension via Settings > Node.js Socket > Connect.
 * Trace events will appear in the DiagnosticsPanel under the lime "Conn" category.
 *
 * Usage: npx tsx demo.ts
 */
import { GsdConnectServer } from './src/server.js';
import { GsdWalletConnect } from './src/client.js';
import { createTracer } from './src/tracer.js';

const PORT = 6372;

const server = new GsdConnectServer({ port: PORT });
await server.start();
console.log(`\n  Socket server listening on ws://127.0.0.1:${PORT}`);
console.log('  Open GSD Wallet → Settings → Node.js Socket → Connect\n');

// Log when extension connects
const checkConnection = setInterval(() => {
  if (server.isGsdConnected) {
    clearInterval(checkConnection);
    console.log('  ✓ GSD Wallet extension connected!\n');
    runDemo();
  }
}, 500);

// Listen for diagnostic events coming FROM the wallet
server.onDiagnosticEvent((event) => {
  console.log(`  [GSD → Node] ${event.level}/${event.category}: ${event.message}`);
});

async function runDemo() {
  const client = new GsdWalletConnect({}, server);
  const tracer = createTracer(server);

  // Simple trace events
  client.emitTrace('info', 'Hello from Node.js socket!');
  await pause(800);

  client.emitTrace('warn', 'This is a test warning from Node.js');
  await pause(800);

  // Scoped tracer
  const deploy = tracer.scope('deploy');
  deploy.info('preparing contract', { name: 'token-transfers' });
  await pause(500);
  deploy.info('compiling circuits', { count: 3 });
  await pause(500);

  // Timed span
  await tracer.span('prove-circuit', async () => {
    await pause(1500);
    return 'proof-bytes';
  });

  tracer.flush();
  await pause(500);

  // Realistic flow with clickable explorer data (64-char hex values)
  const fakeContractAddr = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
  const fakeTxHash = 'deadbeef0123456789abcdef0123456789abcdef0123456789abcdef01234567';
  const fakeTxHash2 = 'cafebabe9876543210fedcba9876543210fedcba9876543210fedcba98765432';

  const tx = tracer.scope('tx');
  tx.info('deploying contract', { contractAddress: fakeContractAddr });
  await pause(400);
  tx.info('contract deployed', { contractAddress: fakeContractAddr, blockHeight: 42857 });
  await pause(600);
  tx.info('balancing transaction', { contractAddress: fakeContractAddr });
  await pause(400);
  tx.info('transaction balanced and signed', { txHash: fakeTxHash, contractAddress: fakeContractAddr });
  await pause(400);
  tx.info('transaction submitted', { txHash: fakeTxHash });
  await pause(600);
  tx.info('second mint call', { txHash: fakeTxHash2, contractAddress: fakeContractAddr, blockHeight: 42860 });
  tracer.flush();

  await pause(500);
  client.emitTrace('info', 'Demo complete — expand events above to see clickable addresses and tx hashes');

  console.log('\n  Demo events sent. Check the DiagnosticsPanel in the wallet popup.');
  console.log('  Filter by "Conn" category to see only socket events.');
  console.log('  Press Ctrl+C to stop.\n');
}

function pause(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Keep alive until Ctrl+C
process.on('SIGINT', async () => {
  console.log('\n  Shutting down...');
  await server.stop();
  process.exit(0);
});
