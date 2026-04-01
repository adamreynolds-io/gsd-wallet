# Midnight Wallet Integration Guide

> **This is not official Midnight documentation.** This guide is a collection of lessons learned while building the [GSD Wallet](https://github.com/adamreynolds-io/gsd-wallet) Chrome extension. It documents platform constraints, silent failure modes, serialization traps, and gaps between the SDK's documented APIs and real-world integration. Where this guide conflicts with the canonical SDK reference, the SDK reference is authoritative.

## Canonical SDK Reference

The only authoritative source for the Midnight Wallet SDK is:

- [docs/sdk-reference/](./sdk-reference/) -- snapshot from `@midnight-ntwrk/wallet-sdk` v3.0.0 (2026-03-28)
  - [Architecture & Design](./sdk-reference/design.md) -- three-wallet model, facade pattern, variants
  - [Package APIs](./sdk-reference/packages/) -- per-package reference (facade, shielded, unshielded, dust, HD, address format, etc.)
  - [Code Examples](./sdk-reference/examples/) -- runnable snippets for initialization, transfers, balancing, swaps, dust operations

For the latest SDK docs, see the [midnight-wallet](https://github.com/midnightntwrk/midnight-wallet) repository.

---

## 1. Decision Matrix

Before writing code, determine your integration target:

| Platform | Polyfills needed | Storage | DApp Connector | WASM CSP |
|----------|-----------------|---------|----------------|----------|
| **Chrome Extension (MV3)** | Buffer, assert, DOM shims | IndexedDB (persistent SDK state + app data) + chrome.storage.session (transient) | Yes (content script + inpage injection) | `wasm-unsafe-eval` in manifest |
| **Electron** | None (has Node.js) | Filesystem or IndexedDB | Optional (BrowserWindow injection) | None (Node.js context) |
| **Node.js (headless)** | None | Filesystem | No | None |
| **React Native** | **NOT SUPPORTED** | — | — | — |

**React Native is not supported.** The SDK depends on WASM modules (`@midnight-ntwrk/ledger-v8`) that are incompatible with JavaScriptCore and Hermes runtimes. Node.js `crypto` and `Buffer` APIs are used throughout. `@subsquid/scale-codec` requires the `assert` module. There is no path forward without a full SDK rewrite targeting RN runtimes.

### Proving strategy

| Strategy | When to use | Config |
|----------|-------------|--------|
| **Server-side prover** | Development, QA, headless | `makeServerProvingService({ provingServerUrl: new URL('http://localhost:6300') })` |
| **WASM prover** | Production browser wallets | Requires offscreen document (Chrome) or Web Worker; not yet available in SDK |

The WASM prover is not yet production-ready. All current wallets use the server-side prover at `localhost:6300`. Run it with:
```bash
docker run -d -p 6300:6300 ghcr.io/midnight-ntwrk/proof-server:8.0.2 midnight-proof-server -v
```

---

## 2. SDK Package Map

Install these packages. **All must be from the same release version.**

```
@midnight-ntwrk/wallet-sdk-facade       ← Orchestrator (start here)
  ├── @midnight-ntwrk/wallet-sdk-shielded     ← ZK private transfers
  ├── @midnight-ntwrk/wallet-sdk-unshielded-wallet  ← Transparent transfers
  ├── @midnight-ntwrk/wallet-sdk-dust-wallet  ← Fee management
  └── @midnight-ntwrk/wallet-sdk-capabilities ← Proving service factory

@midnight-ntwrk/wallet-sdk-hd           ← HD key derivation (standalone)
@midnight-ntwrk/wallet-sdk-address-format ← Bech32m address encoding
@midnight-ntwrk/ledger-v8               ← WASM ledger types (ZswapSecretKeys, DustSecretKey)
@midnight-ntwrk/wallet-sdk-abstractions ← NetworkId enum
@midnight-ntwrk/dapp-connector-api      ← DApp connector type definitions (if implementing)
```

### Hidden transitive dependency: `@subsquid/scale-codec`

Used by `wallet-sdk-address-format` for DustAddress encoding. Requires Node.js `assert` module. In Chrome extensions, you must polyfill it:

```typescript
if (!(globalThis as Record<string, unknown>)['assert']) {
  const assertFn = (condition: unknown, message?: string) => {
    if (!condition) throw new Error(message ?? 'Assertion failed');
  };
  assertFn.default = assertFn;  // Some modules use require('assert').default
  (globalThis as Record<string, unknown>)['assert'] = assertFn;
}
```

---

## 3. Initialization Sequence

This is the exact sequence. Each step has a tagged return type that **fails silently if not checked**.

### Step 0: Mnemonic to seed

If you generate or import a BIP-39 mnemonic, convert it to a seed using `mnemonicToEntropy` — **not** `mnemonicToSeedSync`. The SDK uses raw entropy (32 bytes for a 256-bit mnemonic), not the PBKDF2-derived 64-byte BIP-39 seed.

```typescript
import { mnemonicToEntropy, generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

const mnemonic = generateMnemonic(wordlist, 256); // 24 words
const entropy = mnemonicToEntropy(mnemonic, wordlist);
const seed = new Uint8Array(entropy.slice(0, 32));
```

**Trap:** Using `mnemonicToSeedSync` produces a different 64-byte seed via PBKDF2. Truncating it to 32 bytes gives you a seed that derives completely different keys from the same mnemonic. The official SDK tests confirm `mnemonicToEntropy` is the correct conversion.

### Step 1: Derive keys from seed

```typescript
import { HDWallet, Roles, type Role } from '@midnight-ntwrk/wallet-sdk-hd';

const hdWallet = HDWallet.fromSeed(seed);
seed.fill(0); // Wipe seed from memory immediately after use

if (hdWallet.type !== 'seedOk') {
  throw new Error('Invalid seed');  // No error message in the type — just a tag
}

// Derive per-role with retry — there is a small probability of
// derivation failure at any given index, so retry with the next index.
const account = hdWallet.hdWallet.selectAccount(0);
function deriveRoleKey(role: Role, index = 0): Uint8Array {
  const result = account.selectRole(role).deriveKeyAt(index);
  if (result.type === 'keyDerived') return result.key;
  if (index >= 5) throw new Error(`Key derivation failed for role ${role}`);
  return deriveRoleKey(role, index + 1);
}

const derivedKeys = {
  [Roles.Zswap]: deriveRoleKey(Roles.Zswap),
  [Roles.NightExternal]: deriveRoleKey(Roles.NightExternal),
  [Roles.Dust]: deriveRoleKey(Roles.Dust),
};

hdWallet.hdWallet.clear();  // Free memory — don't skip this
```

**Trap:** If you don't check `.type`, the code continues with undefined keys and fails deep inside the facade with cryptic errors.

**Seed wiping:** Call `seed.fill(0)` after `HDWallet.fromSeed()` and `hdWallet.clear()` after derivation. The SDK's own examples demonstrate this pattern.

**Roles:**
- `Roles.Zswap` (3) → shielded wallet seed
- `Roles.NightExternal` (0) → unshielded wallet seed
- `Roles.Dust` (2) → dust wallet seed

### Step 2: Create secret keys and keystore

```typescript
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { createKeystore, PublicKey } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';

const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(derivedKeys[Roles.Zswap]);
const dustSecretKey = ledger.DustSecretKey.fromSeed(derivedKeys[Roles.Dust]);
const unshieldedKeystore = createKeystore(derivedKeys[Roles.NightExternal], networkId);
```

### Step 3: Initialize the facade

```typescript
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { CustomShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { V1Builder as ShieldedV1Builder, Sync as ShieldedSync } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { UnshieldedWallet } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { makeServerProvingService } from '@midnight-ntwrk/wallet-sdk-capabilities';
import { CustomDustWallet } from './customDustWallet'; // local wrapper (see section 4)
import { V1Builder as DustV1Builder, SyncService as DustSyncService } from '@midnight-ntwrk/wallet-sdk-dust-wallet/v1';
import { makeCachingShieldedSyncService } from './cachingSyncService';
import { makeCachingDustSyncService } from './cachingDustSyncService';
```

Add the builder helpers before the facade init:
```typescript
// Caching sync builders — events are written to IndexedDB as they arrive,
// so other wallets on the same network can replay from cache instead of
// re-downloading from the indexer.
const shieldedBuilder = new ShieldedV1Builder()
  .withDefaultTransactionType()
  .withSync(makeCachingShieldedSyncService(environment), ShieldedSync.makeEventsSyncCapability)
  .withSerializationDefaults()
  .withTransactingDefaults()
  .withCoinSelectionDefaults()
  .withCoinsAndBalancesDefaults()
  .withTransactionHistoryDefaults()
  .withKeysDefaults();

const dustBuilder = new DustV1Builder()
  .withDefaultTransactionType()
  .withSync(makeCachingDustSyncService(environment), DustSyncService.makeDefaultSyncCapability)
  .withSerializationDefaults()
  .withTransactingDefaults()
  .withCoinSelectionDefaults()
  .withCoinsAndBalancesDefaults()
  .withKeysDefaults();
```

Then in the facade init, change the wallet factories:
```typescript
const facade = await WalletFacade.init({
  configuration: {
    networkId,
    indexerClientConnection: { indexerHttpUrl, indexerWsUrl },
    provingServerUrl: new URL(provingServerUrl),
    relayURL: new URL(nodeWsUrl),
    costParameters: { feeBlocksMargin: 5 },
    txHistoryStorage: new InMemoryTransactionHistoryStorage(),
  },
  shielded: (cfg) => CustomShieldedWallet(cfg, shieldedBuilder).startWithSeed(derivedKeys[Roles.Zswap]),
  unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
  dust: (cfg) => CustomDustWallet(cfg, dustBuilder).startWithSeed(
    derivedKeys[Roles.Dust],
    ledger.LedgerParameters.initialParameters().dust,
  ),
  provingService: () => makeServerProvingService({ provingServerUrl: new URL(provingServerUrl) }),
});
```

### Step 4: Subscribe to state BEFORE starting

Subscribe to the state observable immediately after `init()`, before calling `start()`. This ensures you receive every state update from the moment the facade connects.

```typescript
facade.state().subscribe((facadeState) => {
  // facadeState contains shielded, unshielded, dust subsystem states
  // This fires on every state change (sync progress, balance updates, etc.)
});
```

### Step 5: Start the facade (NON-BLOCKING)

```typescript
// Do NOT await — let sync happen in the background
facade.start(shieldedSecretKeys, dustSecretKey)
  .then(() => { /* facade connected and syncing */ })
  .catch((err) => { /* connection failed — handle gracefully */ });
```

**Trap:** `WalletFacade.init()` does NOT start the wallet. You MUST call `.start()` separately. Missing this = wallet never syncs, no state updates, no errors — just silence.

**Performance trap:** If you `await facade.start()` before subscribing to state, the UI blocks for the entire connection + sync duration. Subscribe first, then start without awaiting. The state observable will emit updates as each wallet connects and syncs.

**Reference:** `gsd-wallet/src/offscreen/walletManager.ts:initializeWalletCore`

---

## 4. Platform-Specific Gotchas

### Chrome Extension (MV3)

#### Polyfills required in offscreen document

The SDK runs in the offscreen document (not the service worker). The offscreen document has `document` and `window` natively, but needs Node.js polyfills. Two polyfills are mandatory:

```typescript
// 1. Buffer (for Polkadot/Substrate SDK used by wallet-sdk-node-client)
import { Buffer } from 'buffer';
(globalThis as Record<string, unknown>)['Buffer'] = Buffer;

// 2. assert (for @subsquid/scale-codec used by DustAddress encoding)
const assertFn = (condition: unknown, message?: string) => {
  if (!condition) throw new Error(message ?? 'Assertion failed');
};
assertFn.default = assertFn;
(globalThis as Record<string, unknown>)['assert'] = assertFn;
```

These must be at the TOP of the offscreen document entry point, before any SDK imports. DOM shims are not needed — the offscreen document is a full HTML page with native `document` and `window`.

**Reference:** `gsd-wallet/src/offscreen/offscreen.ts`

#### Manifest CSP for WASM

```json
"content_security_policy": {
  "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
}
```

Without `wasm-unsafe-eval`, the ledger WASM module will fail to instantiate with no useful error message.

#### Service worker lifecycle and the offscreen document

Chrome terminates idle service workers after ~30 seconds. WebSocket connections (used by `@polkadot/api` for node/indexer communication) do NOT count as activity.

**The fix: run the SDK in an offscreen document.** The offscreen document is a persistent extension page that Chrome does not garbage-collect. It maintains WebSocket connections indefinitely without keepalive hacks. The service worker becomes a thin message router — it can freely die and restart without affecting the SDK.

The offscreen document initiates a port connection to the SW on load. When the SW restarts, the offscreen detects the port disconnect and reconnects to the new SW instance automatically.

**Note:** `chrome.storage` APIs are not available in offscreen documents. State caching must be done by the SW (which receives state broadcasts over the port).

#### Persistent SDK storage (checkpoints)

The SDK provides serialization/restore on all three wallet types. Checkpoints allow sync to resume after a full browser restart (the only scenario where the offscreen document is lost).

```typescript
// Serialize
const [shielded, unshielded, dust] = await Promise.all([
  facade.shielded.serializeState(),
  facade.unshielded.serializeState(),
  facade.dust.serializeState(),
]);
const txHistory = txHistoryStorage.serialize();
await db.put('sdkState', { shieldedState, unshieldedState, dustState, txHistory, savedAt, sdkVersion });
```

```typescript
// Restore — on wallet initialization, check for checkpoint first
const checkpoint = await db.get('sdkState', key);
if (checkpoint) {
  const facade = await WalletFacade.init({
    configuration: { ...config, txHistoryStorage: InMemoryTransactionHistoryStorage.fromSerialized(checkpoint.txHistory) },
    shielded: (cfg) => CustomShieldedWallet(cfg, shieldedBuilder).restore(checkpoint.shieldedState),
    unshielded: (cfg) => UnshieldedWallet(cfg).restore(checkpoint.unshieldedState),
    dust: (cfg) => CustomDustWallet(cfg, dustBuilder).restore(checkpoint.dustState),
    provingService: () => makeServerProvingService({ ... }),
  });
}
```

**Checkpointing strategy:**
- Save when `isSynced` transitions to `true`
- Save before `facade.stop()` on wallet lock/shutdown
- Never block the UI or state emission on checkpoint writes
- Store the SDK package version — discard checkpoints after SDK upgrades
- Periodic saves are unnecessary — the offscreen document is persistent, so the only data loss scenario is a full browser crash

**Error handling:** Wrap restore in try/catch. If deserialization fails (corrupt data, schema change), clear the checkpoint and fall back to fresh sync.

**Scoping:** Key checkpoints by `${environment}:${accountIndex}:${walletId}` so each wallet/network combination has independent state. Derive `walletId` from a hash of the seed (never raw seed bytes) to avoid leaking key material in storage keys or logs.

**Reference:** `gsd-wallet/src/offscreen/sdkCheckpoint.ts`, `gsd-wallet/src/offscreen/walletManager.ts:initializeWalletCore`, `gsd-wallet/src/shared/storage.ts`

#### Shared network event cache

The indexer streams all shielded (ZswapEvents) and dust (DustLedgerEvents) events on the chain — the same events for every wallet on the same network. By default, each wallet downloads these independently. With the caching sync layer, events are written to IndexedDB as they arrive and shared across wallets.

**How it works:**

1. The first wallet on a network syncs from the indexer as normal. As events flow through the caching sync service, raw hex payloads are written to the `networkEvents` IndexedDB store (batched, fire-and-forget — no sync pipeline blocking).
2. When a second wallet on the same network starts, the caching sync service replays cached events from IndexedDB before connecting to the live indexer subscription. The live subscription starts from `max(appliedIndex, maxCachedEventId)`, fetching only the delta.
3. Cache writes are keyed by `{network}:{type}:{id}` where type is `zswap` or `dust`. Different networks have independent caches.

**What's cached vs wallet-specific:**

| Data | Scope | Storage |
|------|-------|---------|
| ZswapEvents (shielded) | Network-level — same for all wallets | `networkEvents` IndexedDB store |
| DustLedgerEvents | Network-level — same for all wallets | `networkEvents` IndexedDB store |
| Coins, balances, nullifiers | Wallet-specific — derived by filtering events with wallet keys | `sdkState` checkpoint store (unchanged) |
| Unshielded transactions | Address-filtered server-side | No caching needed (fast sync) |

**Implementation:** The caching layer replaces the SDK's default sync services via `V1Builder.withSync()`. `CustomShieldedWallet` (SDK export) and `CustomDustWallet` (local wrapper — the SDK doesn't export one) accept custom builders. The sync capability (`applyUpdate`) is reused unchanged from the SDK — only the event source is replaced.

**Bundled cache snapshot:** On fresh install, a bundled NDJSON snapshot (`public/data/{network}-cache.ndjson`) is imported into the `networkEvents` IndexedDB store before sync starts, taking ~5s. This eliminates the network download entirely for cached events. If the bundled file is not found, the importer falls back to a remote URL (configurable in `REMOTE_CACHE_URLS`). The cache can be exported via the `EXPORT_CACHE` worker message to produce an NDJSON file for sharing across installations or archiving.

**Performance:** On mainnet with ~89k events per type, cache import takes ~5s and cache replay ~3 min (CPU-bound `ledger.Event.deserialize()`), followed by a ~2s live delta sync — total ~3 min 17s from fresh install (vs 6+ min from indexer). The network download is eliminated entirely. The main benefit is for slow/unreliable connections and for avoiding redundant indexer load across multiple wallets.

**Reference:** `gsd-wallet/src/offscreen/cachingSyncService.ts`, `gsd-wallet/src/offscreen/cachingDustSyncService.ts`, `gsd-wallet/src/offscreen/customDustWallet.ts`, `gsd-wallet/src/offscreen/cacheImporter.ts`, `gsd-wallet/src/shared/storage.ts:networkEvents`

#### Popup height limit

Chrome enforces a maximum popup height based on the user's viewport — typically ~600px. Design your popup UI for this constraint. For larger views, provide an "Open in Full Tab" button:

```typescript
chrome.tabs.create({ url: chrome.runtime.getURL('src/popup/index.html') });
```

#### postMessage cannot serialize BigInt

All wallet balances are `bigint`. `postMessage` (and `JSON.stringify`) throw on BigInt. Convert to string at every IPC boundary:

```typescript
// Service worker → popup
const balances: Record<string, string> = {};
for (const [tokenId, amount] of Object.entries(facadeState.unshielded.balances)) {
  balances[tokenId] = String(amount);
}

// Popup → display
const value = BigInt(balances[tokenId]);
```

#### Live state updates via chrome.storage.onChanged

Chrome MV3 port message delivery (`port.postMessage`) is unreliable for long-lived connections. Messages sent by the service worker may silently fail to reach the popup, especially after reconnections. **Do not rely on port broadcasts alone for live UI updates.**

**Solution: Dual-channel updates.** The service worker writes state to `chrome.storage.session` on every update. The popup watches for changes via `chrome.storage.onChanged`:

```typescript
// Service worker — writes on every state change (already happening for caching)
chrome.storage.session.set({ gsdLastState: serializedState });

// Popup — watches for changes (bulletproof, no port dependency)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session') return;
  if (changes['gsdLastState']?.newValue) {
    store.setWalletState(changes['gsdLastState'].newValue);
  }
  if (changes['gsdDiagnosticEvents']?.newValue) {
    store.addDiagnosticEventsBatch(changes['gsdDiagnosticEvents'].newValue);
  }
});
```

This works across all open popup/tab instances simultaneously and is immune to port lifecycle issues.

**Reference:** `gsd-wallet/src/popup/hooks/useWalletState.ts`

#### Disclaimer gate for DApp requests

If your wallet includes a disclaimer or terms-of-use gate, ensure DApp API requests are also blocked — not just the popup UI. The service worker must independently check the disclaimer state before processing any DApp request:

```typescript
async function handleDappRequest(payload, origin) {
  const result = await chrome.storage.local.get('gsdDisclaimerAccepted');
  if (result['gsdDisclaimerAccepted'] !== true) {
    return { type: 'GSD_ERROR', error: { code: 'NotReady', reason: 'Disclaimer not accepted' } };
  }
  // ... handle request
}
```

Store the disclaimer acceptance in `chrome.storage.local` (persists across browser restarts), not `session`.

**Reference:** `gsd-wallet/src/background/messageRouter.ts:isDisclaimerAccepted`, `gsd-wallet/src/popup/App.tsx:Disclaimer`

### Electron

No polyfills needed — Node.js APIs are available natively. Use `fs` for encrypted storage. Same SDK initialization sequence applies.

### Node.js (headless)

Simplest integration. No UI, no polyfills, no DApp connector. The SDK uses the Effect library internally — you can use it directly if desired, but Promise-based APIs are available via `QueryRunner.runPromise()`.

### React Native — NOT SUPPORTED

The Midnight SDK cannot run in React Native environments:
- **WASM**: `@midnight-ntwrk/ledger-v8` contains WebAssembly modules. Neither JavaScriptCore (iOS) nor Hermes (Android) supports WASM execution.
- **Node.js APIs**: `Buffer`, `crypto`, `assert` are used throughout the SDK dependency tree. RN polyfills (e.g., `react-native-get-random-values`) don't cover all cases.
- **WebSocket handling**: The SDK uses `@polkadot/api` for node communication, which expects a browser-compatible WebSocket. RN's WebSocket implementation has known incompatibilities.

There is no workaround. A React Native Midnight wallet would require the SDK team to provide a native module or a complete RN-compatible rewrite.

---

## 5. State Model & Serialization

The facade emits a `FacadeState` object via its RxJS observable. This object is complex and cannot be passed directly over IPC.

### Balance fields

| Field | Type | Gotcha |
|-------|------|--------|
| `shielded.balances` | `Record<tokenId, bigint>` | Must stringify for IPC |
| `unshielded.balances` | `Record<tokenId, bigint>` | Must stringify for IPC |
| `dust.balance(date)` | Method returning `bigint` | **It's a method, not a property.** Call with `new Date()`. Throws if dust wallet not yet synced. |

### Sync progress — different shapes per subsystem

| Subsystem | Applied field | Highest relevant field | Chain tip field | Connected field |
|-----------|--------------|----------------------|-----------------|-----------------|
| Shielded | `appliedIndex` | `highestRelevantWalletIndex` | `highestIndex` | `isConnected` |
| Unshielded | `appliedId` | `highestTransactionId` | — | `isConnected` |
| Dust | `appliedIndex` | `highestRelevantWalletIndex` | `highestIndex` | `isConnected` |

All fields are `bigint`. Shielded and dust also expose `highestIndex` (the global chain tip) and `highestRelevantIndex`.

**Trap:** `highestRelevantWalletIndex === 0` does NOT mean "synced at block 0". It means the indexer hasn't determined the highest relevant index yet. You must also check `highestIndex` (the global chain tip) to distinguish "nothing relevant yet" from "not connected yet".

### Displaying sync progress

Show per-wallet progress bars with `applied / highest` event counts. This gives users concrete visibility into how far each wallet has synced:

```
S [======--] 45k/87k   U [========] 0/0   D [==------] 14k/87k
```

Calculate percentage as `(applied / highest) * 100`. When `highest === 0` and `isConnected`, treat as 100% (no relevant events). When `!isConnected`, show a gray/disconnected state.

**Reference:** `gsd-wallet/src/popup/pages/Dashboard.tsx:MiniSyncBar`

### UTXO intent hash is NOT a transaction hash

The SDK's `utxo.intentHash` is an internal cryptographic identifier — a hash of the transaction "intent" (the logical operation), not the on-chain transaction hash. **You cannot look up an intent hash on the indexer.** The indexer's `transactions(offset: { hash })` query expects the actual transaction hash, which is a different value.

If you need to link UTXOs to their creating transaction, the only way is to subscribe to unshielded transaction events and track the mapping yourself, or use the `createdAtTransaction` field when querying UTXOs through the indexer's GraphQL API (as a nested field on transaction results, not as a top-level query).

### Address encoding can throw

```typescript
import { MidnightBech32m, DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';

// These can throw — always wrap in try-catch
try {
  const shieldedAddr = MidnightBech32m.encode(networkId, facadeState.shielded.address).toString();
} catch {
  // Address not yet available or encoding failed
}

try {
  const dustAddr = DustAddress.encodePublicKey(networkId, facadeState.dust.publicKey);
} catch {
  // DustAddress encoding is particularly fragile (uses scale-codec internally)
}
```

**Reference:** `gsd-wallet/src/offscreen/walletManager.ts:serializeState`

---

## 6. DApp Connector Implementation

If building a wallet that injects into web pages (Chrome extension or Electron):

### Architecture

```
Page (main world)       Content Script (isolated)      Service Worker           Offscreen Document
  inpage.js               content-script.ts              messageRouter.ts         connectedApiHandler.ts
  window.midnight[uuid] ←→ persistent port bridge    ←→ forwards via port    ←→ WalletFacade + API handlers
```

The service worker validates DApp sessions and forwards API calls to the offscreen document over a typed request/response port protocol. The offscreen document hosts the `WalletFacade` and executes all SDK operations (balancing, signing, proving).

### Injection pattern

Content script injects the inpage script into the page's main world:

```typescript
const script = document.createElement('script');
script.src = chrome.runtime.getURL('src/content-script/inpage.js');
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);
```

Manifest must declare the file as web-accessible:
```json
"web_accessible_resources": [{
  "resources": ["src/content-script/inpage.js"],
  "matches": ["<all_urls>"]
}]
```

### Discovery event

After registering `window.midnight[uuid]`, dispatch the discovery event:

```typescript
window.dispatchEvent(new CustomEvent('midnight#ready', { detail: { uuid: walletId } }));
```

DApps listen for this event — without it, they cannot detect the wallet. This is **not documented in the SDK**; it's part of the dApp connector specification.

### Persistent port for long operations

Proving operations take 30+ seconds. Chrome's one-shot `chrome.runtime.sendMessage` can timeout. Use a persistent port:

```typescript
const port = chrome.runtime.connect({ name: 'gsd-dapp' });
port.postMessage({ type: 'DAPP_REQUEST', requestId, payload, origin });
port.onMessage.addListener((msg) => {
  if (msg.requestId === requestId) resolve(msg.payload);
});
```

### BigInt serialization for postMessage

Methods like `getShieldedBalances()` return `Record<tokenId, bigint>`. postMessage can't handle BigInt. Maintain a set of methods that return BigInt values and deserialize in the inpage script:

```typescript
const BIGINT_RECORD_METHODS = new Set(['getShieldedBalances', 'getUnshieldedBalances']);

function deserializeBigInts(method: string, result: unknown): unknown {
  if (BIGINT_RECORD_METHODS.has(method) && result && typeof result === 'object') {
    const converted: Record<string, bigint> = {};
    for (const [k, v] of Object.entries(result as Record<string, unknown>)) {
      converted[k] = BigInt(v as string);
    }
    return converted;
  }
  return result;
}
```

**Trap:** If you add a new API method that returns BigInt, you must add it to this set manually. There's no type-safe way to automate this.

### Request timeout

Add a timeout on inpage requests to prevent hung promises. Proving-heavy operations (contract calls, transfers) take 15-30+ seconds, so the timeout must be long enough to accommodate proving and submission:

```typescript
const REQUEST_TIMEOUT_MS = 120_000; // 2 minutes — proving + submission can take 30+ seconds
const timeout = setTimeout(() => {
  window.removeEventListener('message', handleResponse);
  reject(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`));
}, REQUEST_TIMEOUT_MS);
```

**Reference:** `gsd-wallet/src/content-script/inpage.ts`

### Service worker race condition

When Chrome restarts the service worker, `autoUnlock` reinitializes the wallet via the offscreen document. DApp API calls must wait for the offscreen to signal readiness:

```typescript
// In the SW DApp handler, before forwarding to offscreen:
await offscreenClient.waitForReady();
```

The offscreen document's API handler also gates on `walletManager.waitForReady()` to avoid racing with reinitialization.

**Reference:** `gsd-wallet/src/background/messageRouter.ts:handleDappRequest`, `gsd-wallet/src/offscreen/connectedApiHandler.ts:handleApiCall`

---

## 7. Indexer v4 GraphQL API

The indexer provides blockchain data via GraphQL at `/api/v4/graphql`.

### What you CAN query

| Query | Input | Returns |
|-------|-------|---------|
| `transactions(offset: { hash })` | 64-char hex tx hash | Transaction details, block, fees, contract actions, UTXOs |
| `transactions(offset: { identifier })` | Hex identifier | Same (alternative lookup key) |
| `block(offset: { height })` | Integer | Block details, parent, transaction list |
| `block(offset: { hash })` | 64-char hex | Same |
| `contractAction(address)` | 64-char hex contract addr | Deploy/Call/Update, state, balances, entry point |

### What you CANNOT query

- **Wallet addresses** (shielded or unshielded) — privacy by design; no address lookup exists
- **UTXO by intent hash** — intent hash is not a valid query key (see section 5)
- **Token balances by address** — only available via wallet subscription, not indexer
- **Full-text search** — no search endpoint exists

### Auto-detection pattern

When a user pastes a hash into a search field:
- If numeric → block height lookup
- If 64-char hex → try transaction first, if empty result try contract
- Otherwise → invalid input

```typescript
if (/^\d+$/.test(query)) {
  return { kind: 'block', height: Number(query) };
} else {
  // Try as transaction, fall back to contract
  const txResult = await fetchTxDetail(env, query);
  if (txResult) return txResult;
  return await fetchContractDetail(env, query);
}
```

### Schema reference

The authoritative v4 schema is at: `midnight-js/packages/indexer-public-data-provider/schema.graphql`

**Reference:** `gsd-wallet/src/shared/indexerQuery.ts`

---

## 8. Token Model

### Token type IDs

- `NIGHT_TOKEN_ID` = `0000000000000000000000000000000000000000000000000000000000000000` (64 zeros) — the native token
- Contract-minted tokens have IDs derived from: `SHA256(ContractAddress || DomainSeparator)`

### How contract-minted tokens work

**This is not documented in the wallet SDK.** The authoritative source is `midnight-ledger/spec/preliminaries.md`.

When a Compact contract mints tokens via `mintUnshieldedToken()`, the token type ID is computed as:

```
RawTokenType = SHA256(ContractAddress || DomainSeparator)
```

Where:
- **ContractAddress** — the 32-byte address of the contract that called `mintUnshieldedToken()`
- **DomainSeparator** — a 32-byte value chosen by the contract (e.g., `pad(32, "simple:receive")`)

Example from a real Compact contract:
```compact
export circuit mintAndReceive(amount: Uint<64>): Bytes<32> {
    const domain = pad(32, "simple:receive");
    const color = mintUnshieldedToken(
        disclose(domain),
        disclose(amount),
        left<ContractAddress, UserAddress>(kernel.self())
    );
    return color;  // Returns the token type ID (the "color")
}
```

The returned `color` is the `RawTokenType` hash. This is what appears as the token ID in the wallet's balance map.

### How the wallet discovers contract tokens

The wallet does NOT need to know about contracts or domain separators. Discovery is automatic:

1. The wallet subscribes to unshielded transactions via the indexer
2. Each UTXO has a `type` field containing the `RawTokenType` (32-byte hex hash)
3. The wallet groups UTXOs by token type and sums values: `Record<RawTokenType, bigint>`
4. All token types — NIGHT and contract-minted — appear in the same balance map

**No special configuration is needed.** If a contract mints tokens to your address, they appear automatically.

### "NIGHT balance = 0 but other tokens visible" is correct

A wallet showing NIGHT=0 with contract tokens present is **correct behavior, not a bug**. The wallet address received contract-minted tokens (identified by a non-zero token type ID) but no native NIGHT. These are separate entries in the balance map.

**When displaying balances, iterate ALL keys in the balance map.** Don't only show NIGHT. Display unknown token IDs as truncated hex with the full ID available on hover/copy.

### Denominations

| Token | Smallest unit | Display denomination | Conversion |
|-------|--------------|---------------------|------------|
| NIGHT | 1 | 10^6 | `value / 1_000_000n` |
| DUST | 1 (SPECK) | 10^15 | `value / 1_000_000_000_000_000n` |
| Contract tokens | 1 | Contract-defined | Check the contract source for the denomination |

---

## 9. Diagnostic System

Building a wallet on the Midnight SDK requires deep observability. The SDK uses `@polkadot/api` internally which logs critical events (WebSocket disconnects, RPC errors) only to `console.warn/error`. Service workers can be killed by Chrome at any time, losing all in-memory state. The diagnostic system addresses both problems.

### Architecture

```
OFFSCREEN DOCUMENT:
  SDK (@polkadot/api) ──console.warn/error──→ sdkConsoleInterceptor ──emit()──→ offscreen diagnosticLogger
  walletManager ──emit()──→ offscreen diagnosticLogger                                │
                                │                                                      │
                                ├── in-memory buffer (2000 events)                     │
                                └── broadcast via port ──→ SERVICE WORKER              │
                                                              │                        │
SERVICE WORKER:                                               ▼                        │
  messageRouter ──emit()──→ SW diagnosticLogger               │                        │
                                │                              │                        │
                                ├── in-memory buffer           │                        │
                                ├── chrome.storage.session     │                        │
                                └── merges offscreen events ───┘                        │
                                        │                                               │
                                        └── relay to popup ports ──→ DiagnosticsPanel   │
                                                                      ├── filterable    │
                                                                      └── NDJSON export │
```

Two diagnostic loggers exist: one in the offscreen document (SDK events, wallet lifecycle) and one in the SW (routing, popup connections). The offscreen logger broadcasts events to the SW over the port. The SW merges both streams and relays to popup ports. Only the SW logger persists to `chrome.storage.session` — the offscreen document does not have access to `chrome.storage` APIs.

### Event categories

| Category | What it captures |
|----------|-----------------|
| `sw` | Service worker lifecycle (start, install, restart) |
| `wallet` | Facade init, key derivation, start/stop, timing |
| `state` | Sync status transitions (initializing → syncing → synced) |
| `sync` | Per-wallet progress (applied/total every 2s), connection changes, phase transitions, stall detection |
| `sdk` | Intercepted SDK console output (RPC-CORE disconnects, WebSocket errors, @polkadot internals) |
| `dapp` | DApp connect/disconnect, API method calls |
| `api` | DApp API handler results |
| `tx` | Transaction phases (balance, sign, prove, submit) |
| `indexer` | GraphQL queries |
| `error` | Errors at any layer |

### Persistence

SW-side events are persisted to `chrome.storage.session` via debounced writes. On SW startup, `rehydrate()` restores the buffer. Events are cleared when the browser closes, which is appropriate for diagnostic data.

Offscreen-side events are kept in-memory only — the offscreen document is persistent, so this is safe during a session. They are broadcast to the SW over the port for relay to the popup. `chrome.storage` APIs are not available in offscreen documents.

Each SW lifecycle gets a unique `sessionId` (UUID) — visible in the "Service worker started" event — so you can identify restarts in the event stream.

### Stall detection

An independent `setInterval` (10s) checks whether the combined applied count across all three wallets has advanced in the last 30 seconds. This runs outside the RxJS subscription, so it detects stalls even when the SDK's state observable stops emitting (e.g., after a WebSocket disconnect kills the underlying data stream).

When a stall is detected:
- `syncPhase` is set to `'stalled'` and broadcast to the popup
- A `warn` level `sync` event is emitted with per-wallet progress data
- The header badge shows "Stalled"

### SDK console interception

The `@polkadot/api` library logs critical events (WebSocket disconnects, RPC errors, reconnections) only to `console.warn/error`. In a service worker, these are invisible unless DevTools is open. Monkey-patch `console.warn` and `console.error` before any SDK imports to capture these as structured diagnostic events:

```typescript
// Must be called BEFORE setupMessageRouter() or any SDK imports
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  originalWarn.apply(console, args);
  const message = args.map(String).join(' ');
  if (isSdkMessage(message)) {
    emit('warn', 'sdk', message);
  }
};

function isSdkMessage(msg: string): boolean {
  return msg.includes('RPC-CORE') || msg.includes('disconnected from') ||
    msg.includes('WebSocket') || msg.includes('@polkadot');
}
```

This captures errors like `RPC-CORE: subscribeRuntimeVersion(): disconnected from wss://rpc.mainnet.midnight.network/: 1000:: Normal Closure` which are invisible in every other Midnight wallet.

**Reference:** `gsd-wallet/src/offscreen/sdkConsoleInterceptor.ts`

### Diagnostic event flush timing

SW-side events are flushed to `chrome.storage.session` after 100ms or 3 accumulated events, whichever comes first. On SW startup, `rehydrate()` restores persisted events from the previous lifecycle.

Offscreen-side events are broadcast immediately to the SW over the port (no batching). The SW relays them to connected popup ports and merges them into its own diagnostic stream.

### Calculating overall sync percentage

Do NOT average per-wallet percentages — this inflates the result because unshielded (374 events at 100%) gets equal weight to shielded (87k events at 40%). Instead, sum applied and highest across all wallets:

```typescript
const totalApplied = shielded.applied + unshielded.applied + dust.applied;
const totalHighest = shielded.highest + unshielded.highest + dust.highest;
const overallPercent = totalHighest > 0 ? Math.floor((totalApplied / totalHighest) * 100) : 0;
```

### Why shielded/dust sync is slow

The indexer streams **all** ZSwap (shielded) and dust events on the chain, not just those belonging to the wallet. This is a privacy design choice: if the indexer filtered by viewing keys, it would learn which addresses belong to the wallet, breaking the privacy model. The wallet receives all events and filters locally.

Unshielded transactions are public and can be filtered server-side, so they sync instantly.

On mainnet with ~89k shielded and ~89k dust events, first sync takes ~3 min from the bundled cache snapshot (vs 6+ min downloading from the indexer). Subsequent opens restore from per-wallet checkpoints and only sync the delta (~2s). The shared network event cache (see section 4) allows wallets on the same network to replay cached events from IndexedDB instead of re-downloading from the indexer — eliminating network I/O for all wallets after the first.

---

## 10. Common Failure Modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| Wallet hangs on "Initializing" | `facade.start()` blocks until connected | Subscribe to state before calling `start()`; don't await `start()` — let it run in background. Emit an initial zero-progress state so UI renders immediately |
| State updates continue after clearing wallet | Old facade RxJS subscription still emitting | Guard state handler: ignore updates when `hasVault === false` |
| `TypeError: Do not know how to serialize a BigInt` | BigInt passed through `postMessage` or `JSON.stringify` | Convert to string at every IPC boundary |
| Address shows as empty string | `MidnightBech32m.encode()` threw (address not yet synced) | Wrap in try-catch, show placeholder |
| UTXO hash "Not found in indexer" | `intentHash` is not a transaction hash | Don't use intent hash as indexer lookup key |
| Popup scrolls past bottom | Chrome enforces viewport height limit (~600px) | Cap popup height; offer "Open in Full Tab" |
| Service worker dies mid-sync | Chrome kills idle SWs after ~30s; WebSockets don't count as activity | Run the SDK in an offscreen document (see section 13). The offscreen is persistent — SW restarts don't affect sync. |
| Sync restarts from 0 on browser restart | `InMemoryTransactionHistoryStorage` and wallet state are in-memory only | Implement persistent SDK storage with `serializeState()`/`restore()` and `InMemoryTransactionHistoryStorage.serialize()`/`fromSerialized()` (see section 4) |
| Popup shows stale data after close/reopen | Port message delivery unreliable in MV3 | SW caches state to `chrome.storage.session` on every offscreen broadcast; popup reads cache on connect and watches `chrome.storage.onChanged` as fallback |
| Sync percentage inflated (61% shown, actual 43%) | Averaging per-wallet percentages equally | Use `totalApplied / totalHighest` across all wallets |
| API call hangs after SW restart | `autoUnlock` reinitializes facade while API handler uses old ref | Gate API handlers with `waitForReady()` before using facade |
| DApp connects before user accepts disclaimer | Popup gate doesn't block service worker DApp handler | Check disclaimer in both popup AND DApp request handler independently |
| `balanceUnboundTransaction` hangs for contract calls | Dust balancer deterministic `IntentSegmentIdCollision` + 38s synchronous event loop block | Upstream SDK bug — see section 13. Running facade in offscreen document prevents SW death but Chrome may show "page unresponsive" for the offscreen during the 38s computation. |
| `HDWallet.fromSeed` returns but wallet fails later | Didn't check `.type === 'seedOk'` | Always check tagged return types |
| Facade created but never syncs | Forgot to call `facade.start()` after `init()` | `.init()` and `.start()` are separate steps |
| DApps can't discover wallet | Missing `midnight#ready` event dispatch | Dispatch `CustomEvent('midnight#ready')` after injection |
| `dust.balance` throws | Called as property instead of method, or dust not synced | Call as `dust.balance(new Date())` in try-catch |

---

## 11. Documentation Gap Analysis

What the existing Midnight documentation covers vs what you actually need:

| Topic | midnight-wallet docs | midnight-docs site | Status |
|-------|---------------------|-------------------|--------|
| SDK architecture (Design.md, ADRs) | Comprehensive | wallet-dev-guide.mdx | Covered |
| Key derivation (BIP-32, Roles) | HD wallet README | wallet-dev-guide.mdx | Covered |
| Transfer execution | docs-snippets/ examples | guides/ | Covered |
| DApp connector API spec | — | dapp-connector/ reference | API types only |
| **DApp connector implementation** | — | — | **Gap** — no guide for building the injection bridge |
| **Chrome extension integration** | — | lace-wallet.mdx (user guide) | **Gap** — Lace docs are for users, not builders |
| **Service worker polyfills** | — | — | **Gap** — not mentioned anywhere |
| **State serialization for IPC** | — | — | **Gap** — BigInt, address encoding, sync progress |
| **Sync progress field semantics** | — | — | **Gap** — field names differ per subsystem |
| **Indexer v4 query patterns** | schema.graphql | — | **Gap** — schema exists but no usage guide |
| **Intent hash vs transaction hash** | — | — | **Gap** — major confusion source |
| **BigInt IPC serialization** | — | — | **Gap** — affects all wallet-to-UI communication |
| **Token type ID model** | Design.md (briefly) | utxo.mdx (conceptual) | **Partial** — theory but no practical guidance |
| **React Native limitations** | — | — | **Gap** — no explicit statement of non-support |
| **Chrome popup constraints** | — | — | **Gap** — 600px limit not documented |
| **SW lifecycle & persistent storage** | — | — | **Addressed here** — checkpoint pattern with `serializeState()`/`restore()` |
| **Facade computation model vs Chrome SW** | — | — | **Addressed here** — SDK assumes unbounded event loop blocking is safe; Chrome kills unresponsive SWs at ~30s. Fix: run facade in offscreen document (section 13) |
| **Dust balancer segment ID collision** | — | — | **Gap** — deterministic `IntentSegmentIdCollision` for all contract call transactions via DApp connector. Upstream fix required. See section 13 |
| **Offscreen document for facade** | WASM prover example uses `makeWasmProvingService()` | — | **Addressed here** — SDK docs show WASM prover factory but don't address that the entire facade must run outside the SW for Chrome extensions. See section 13 for implemented architecture. |

---

## 12. Reference Implementation

The GSD Wallet runs the facade in an offscreen document with the service worker as a thin message router. Every pattern in this guide has a working implementation:

**Service worker (thin router):**

| Pattern | File | Key function |
|---------|------|-------------|
| SW entry + offscreen lifecycle | `src/background/index.ts` | `ensureOffscreenReady()`, `autoUnlockWallet()` |
| Message routing (popup + DApp) | `src/background/messageRouter.ts` | `setupMessageRouter()`, `handlePopupMessage()`, `handleDappRequest()` |
| Offscreen port client | `src/background/offscreenClient.ts` | `acceptPort()`, `request()`, `waitForReady()` |
| Wallet store CRUD | `src/background/stateManager.ts` | `addWallet()`, `switchWallet()`, `autoUnlock()` |
| SW diagnostic logger | `src/background/diagnosticLogger.ts` | `emit()`, `rehydrate()` — persists to `chrome.storage.session` |
| Update checker | `src/background/updateChecker.ts` | `startUpdateChecker()` |

**Offscreen document (SDK host):**

| Pattern | File | Key function |
|---------|------|-------------|
| SDK host entry + port protocol | `src/offscreen/offscreen.ts` | `handleRequest()`, `connectToServiceWorker()` |
| Facade lifecycle + state serialization | `src/offscreen/walletManager.ts` | `initializeWallet()`, `stopWallet()`, `serializeState()` |
| DApp API handler (17 methods) | `src/offscreen/connectedApiHandler.ts` | `handleApiCall()` |
| Persistent SDK storage (checkpoint) | `src/offscreen/sdkCheckpoint.ts` | `saveCheckpoint()`, `loadCheckpoint()` |
| SDK console interception | `src/offscreen/sdkConsoleInterceptor.ts` | `interceptSdkConsole()` |
| Offscreen diagnostic logger | `src/offscreen/diagnosticLogger.ts` | `emit()`, `setBroadcastFn()` — in-memory, broadcasts to SW |
| Caching shielded sync service | `src/offscreen/cachingSyncService.ts` | `makeCachingShieldedSyncService()` |
| Caching dust sync service | `src/offscreen/cachingDustSyncService.ts` | `makeCachingDustSyncService()` |
| Custom dust wallet factory | `src/offscreen/customDustWallet.ts` | `CustomDustWallet()` — mirrors SDK's `DustWallet()` with custom builder |
| Bundled/remote cache import + NDJSON export | `src/offscreen/cacheImporter.ts` | `importBundledCache()`, `exportCacheAsNdjson()` |
| Parallel scan infrastructure (disabled) | `src/offscreen/scanWorker.ts` | `CoreWallet.replayEvents` direct scan — bypasses SDK sync runtime; disabled pending Merkle tree sequential constraint resolution |

**Shared:**

| Pattern | File | Key function |
|---------|------|-------------|
| Message protocol types | `src/shared/messages.ts` | `PopupRequest`, `PopupResponse`, `OffscreenRequest`, `OffscreenBroadcast` |
| IndexedDB schema | `src/shared/storage.ts` | `getSdkState()`, `saveSdkState()`, `getTxHistory()`, `getNetworkEvents()`, `putNetworkEvents()` |
| Environment configuration | `src/shared/environments.ts` | `ENVIRONMENTS` map |

**Popup + content script (unchanged):**

| Pattern | File |
|---------|------|
| DApp connector (inpage) | `src/content-script/inpage.ts` |
| Content script bridge | `src/content-script/content-script.ts` |
| Popup state + reconnection | `src/popup/hooks/useWalletState.ts` |
| Per-wallet sync progress | `src/popup/pages/Dashboard.tsx` |
| Diagnostics panel | `src/popup/components/DiagnosticsPanel.tsx` |

Repository: `https://github.com/adamreynolds-io/gsd-wallet`

---

## 13. Offscreen Document Architecture

> **Not covered in SDK reference.** The SDK design docs (`docs/sdk-reference/design.md`) describe the variant/capability/SubscriptionRef architecture but assume a Node.js or Electron runtime. The SDK examples (`docs/sdk-reference/examples/wasm-prover.ts`) show `makeWasmProvingService()` as the production prover factory but don't address where the facade should live in a Chrome extension. This section documents the implemented solution.

### The problem

The wallet SDK's `WalletFacade` runs long computations synchronously on the Effect runtime without yielding to the event loop. This is safe in Node.js and Electron. In a Chrome extension service worker, it causes two problems:

1. **SW lifecycle**: Chrome terminates idle service workers after ~30 seconds. The SDK maintains WebSocket connections that don't count as activity.
2. **Event loop blocking**: The SDK's dust balancer (`transactingCapability.balanceTransactions()`) runs ~38 seconds of synchronous computation for contract call transactions.

Additionally, the dust balancer has a deterministic `IntentSegmentIdCollision` bug: it creates a fee intent on the same segment ID as the contract call intent in the input transaction. This collision occurs for every contract call transaction (not deploys, which use the fixed guaranteed segment). The collision is only detected after ~38 seconds of computation, making the failure both slow and guaranteed. See [gsd-wallet#10](https://github.com/adamreynolds-io/gsd-wallet/issues/10) for the full evidence chain.

### Why `setTimeout` and `Promise.race` don't help

A natural mitigation is to wrap the facade call in `Promise.race` with a `setTimeout` timeout:

```typescript
// THIS DOES NOT WORK
const recipe = await Promise.race([
  facade.balanceUnboundTransaction(tx, keys, { ttl }),
  new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 20_000)),
]);
```

This fails because `setTimeout` callbacks are dispatched on the same event loop that the facade computation is blocking. While the dust balancer runs synchronously for 38 seconds, no `setTimeout` callback can fire. The timeout and the computation share a single thread — neither can interrupt the other.

### Implemented architecture: offscreen document as SDK host

The facade runs in an offscreen document with its own event loop. The service worker is a thin message router.

```
DApp <-> content script <-> service worker (router) <-> offscreen document (SDK host)
                                 |                               |
                            session management              WalletFacade
                            port forwarding                 balancing, proving
                            state cache (session storage)   sync, state subscriptions
                            popup port relay                own event loop
```

The offscreen document initiates a port connection to the SW on load (not the other way around — this avoids a race where the SW tries to connect before the offscreen script has loaded). The SW accepts the port and uses it for all SDK operations.

All SDK operations use a typed request/response protocol over the port:

```typescript
// SW sends request with UUID, offscreen responds with matching ID
interface OffscreenRequest { id: string; type: OffscreenRequestType; payload: unknown; }
interface OffscreenResponse { id: string; type: 'RESPONSE' | 'ERROR'; payload: unknown; }
interface OffscreenBroadcast { id: null; type: 'STATE_UPDATE' | 'DIAGNOSTIC_EVENT' | 'HEARTBEAT' | 'READY'; payload: unknown; }
```

Request types: `INIT_WALLET`, `STOP_WALLET`, `GET_STATE`, `DAPP_API_CALL`, `SEND_TRANSFER`, `DUST_REGISTER`, `DUST_DEREGISTER`, `GET_TX_HISTORY`, `GET_DIAGNOSTIC_BACKLOG`.

The SW maintains a `Map<id, {resolve, reject}>` for pending requests with 120-second timeouts. Broadcasts (id=null) are relayed to popup ports.

### What lives where

| Component | Location |
|-----------|----------|
| `WalletFacade` + all three sub-wallets | Offscreen document |
| Proving service (`makeServerProvingService`) | Offscreen document |
| `balanceUnboundTransaction`, `finalizeRecipe`, all transacting | Offscreen document |
| Sync + state subscriptions + stall detection | Offscreen document |
| SDK console interception + offscreen diagnostics | Offscreen document |
| Checkpoint save/load | Offscreen document (IndexedDB is same-origin) |
| Message routing (DApp + popup) | Service worker |
| DApp session management | Service worker |
| State cache for popup (`chrome.storage.session`) | Service worker |
| Wallet store CRUD (seeds, environments) | Service worker |
| SW diagnostic logger (persisted) | Service worker |

### Offscreen document constraints

- **No `chrome.storage` APIs** — `chrome.storage.session` and `chrome.storage.local` are undefined in offscreen documents. State caching must be done by the SW.
- **Only `chrome.runtime`** — Port connections and `sendMessage` work. No other Chrome APIs.
- **Polyfills needed** — `Buffer` and `assert` (but not DOM shims — the offscreen has real `document`/`window`).
- **Web Workers are safe** — Workers spawned by the offscreen document live as long as the offscreen document. They are not subject to SW lifecycle management. This is the path for future WASM proving.

### Reconnection on SW restart

When Chrome kills and restarts the SW, the offscreen document's port disconnects. The offscreen detects this and reconnects after 500ms:

```typescript
port.onDisconnect.addListener(() => {
  setTimeout(connectToServiceWorker, 500);
});
```

The new SW has `setupMessageRouter()` running synchronously at load time, so it's ready to accept the incoming port. The SW then calls `ensureOffscreenReady()` → `waitForReady()` which resolves when the offscreen broadcasts `READY`.

### Upstream SDK issues (not addressable from wallet side)

Two issues require upstream fixes in `@midnight-ntwrk/wallet-sdk-dust-wallet`:

1. **Deterministic segment ID collision**: The dust balancer creates fee intents on the same segment ID as the input transaction's contract call intent. This causes `IntentSegmentIdCollision` for every contract call transaction via the DApp connector. Deploy transactions (segment ID 1) are not affected. The fix: the dust balancer must exclude input transaction segment IDs when creating its fee intent.

2. **Synchronous event loop blocking**: The dust balancer's `transactingCapability.balanceTransactions()` runs ~38 seconds of computation (internal proving) without yielding to the event loop. Even after the collision is fixed, any operation that blocks for >30 seconds is incompatible with Chrome's service worker lifecycle. The fix: the Effect runtime should yield periodically (via `scheduler.yield()` or `setTimeout(0)` trampolining) during long computations.

### Validation

The diagnosis was verified with [adamreynolds-io/issue-734-validation](https://github.com/adamreynolds-io/issue-734-validation) (7 Node.js tests proving the bug is browser-specific) and SDK trace instrumentation in the Chrome extension (identifying the exact stall point inside `dust: balanceTransactions COMPUTING`). Full evidence at [gsd-wallet#10](https://github.com/adamreynolds-io/gsd-wallet/issues/10).

---

## 14. Audit Findings (GSD Wallet v0.1.0)

Code audit performed 2026-03-28 against wallet-sdk v3.0.0 documentation.

### Correct implementations

| Area | Status |
|------|--------|
| HD key derivation (tagged union checks, memory cleanup) | Correct |
| WalletFacade two-phase init (init → subscribe → start in background) | Correct |
| State serialization (BigInt, address encoding, sync progress) | Correct |
| Balance map iteration (all token types, not just NIGHT) | Correct |
| DApp connector API (17 methods, BigInt serialization, session TTL) | Correct |
| `NIGHT_TOKEN_ID` hardcoding | Correct (equivalent to `ledger.unshieldedToken().raw`) |

### Bug found and fixed

**`core/transfer.ts` — conditional signing on internal transfer path.** The internal UI transfer code originally only signed when `tokenType === 'unshielded'`, skipping signing for shielded transfers. **Fixed:** signing now runs whenever `unshieldedKeystore` is available, matching the DApp connector path and SDK examples.

### Not implemented (documented in SDK)

| SDK feature | Status in GSD wallet |
|-------------|---------------------|
| `facade.initSwap()` | Not implemented |
| `facade.estimateRegistration()` | Not implemented |
| `facade.waitForSyncedState()` | Not implemented |
| `getTxHistory()` DApp API | Returns empty array (stub) |
| Transaction history (shielded/dust) | SDK notes: "not yet implemented" in SDK itself |

### Minor deviations (acceptable)

- Uses `CustomShieldedWallet(cfg, builder)` with a caching sync builder instead of the default `ShieldedWallet(cfg)` — injects a custom sync service that caches events to IndexedDB
- Uses a local `CustomDustWallet(cfg, builder)` wrapper because the SDK doesn't export a `CustomDustWallet` — mirrors the SDK's `DustWallet` factory with builder injection support
- Uses `.startWithSeed()` instead of `.startWithSecretKeys()` — both are valid API entry points documented in the SDK
