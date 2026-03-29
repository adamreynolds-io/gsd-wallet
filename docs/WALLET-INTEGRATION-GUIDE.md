# Midnight Wallet Integration Guide

Guide for AI agents building or integrating Midnight wallet functionality. Based on lessons from building the [GSD Wallet](https://github.com/adamreynolds-io/gsd-wallet) Chrome extension.

This guide covers what the SDK docs don't: platform constraints, silent failure modes, serialization traps, and the gaps between documented APIs and real-world integration.

## SDK Reference

Complete SDK documentation is included in [docs/sdk-reference/](./sdk-reference/):

- [Architecture & Design](./sdk-reference/design.md) -- three-wallet model, facade pattern, variants
- [Package APIs](./sdk-reference/packages/) -- per-package reference (facade, shielded, unshielded, dust, HD, address format, etc.)
- [Code Examples](./sdk-reference/examples/) -- runnable snippets for initialization, transfers, balancing, swaps, dust operations

These docs are a snapshot from `@midnight-ntwrk/wallet-sdk` v3.0.0 (2026-03-28). For the latest, see the [midnight-wallet](https://github.com/midnightntwrk/midnight-wallet) repository.

---

## 1. Decision Matrix

Before writing code, determine your integration target:

| Platform | Polyfills needed | Storage | DApp Connector | WASM CSP |
|----------|-----------------|---------|----------------|----------|
| **Chrome Extension (MV3)** | Buffer, assert, DOM shims | IndexedDB + chrome.storage.session | Yes (content script + inpage injection) | `wasm-unsafe-eval` in manifest |
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

### Step 1: Derive keys from seed

```typescript
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';

const hdWallet = HDWallet.fromSeed(seed);
if (hdWallet.type !== 'seedOk') {
  throw new Error('Invalid seed');  // No error message in the type — just a tag
}

const derivation = hdWallet.hdWallet
  .selectAccount(0)
  .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
  .deriveKeysAt(0);

if (derivation.type !== 'keysDerived') {
  throw new Error('Key derivation failed');  // Again, just a tag
}

hdWallet.hdWallet.clear();  // Free memory — don't skip this
```

**Trap:** If you don't check `.type`, the code continues with undefined keys and fails deep inside the facade with cryptic errors.

**Roles:**
- `Roles.Zswap` (3) → shielded wallet seed
- `Roles.NightExternal` (0) → unshielded wallet seed
- `Roles.Dust` (2) → dust wallet seed

### Step 2: Create secret keys and keystore

```typescript
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { createKeystore, PublicKey } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';

const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(derivation.keys[Roles.Zswap]);
const dustSecretKey = ledger.DustSecretKey.fromSeed(derivation.keys[Roles.Dust]);
const unshieldedKeystore = createKeystore(derivation.keys[Roles.NightExternal], networkId);
```

### Step 3: Initialize the facade

```typescript
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { UnshieldedWallet } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { makeServerProvingService } from '@midnight-ntwrk/wallet-sdk-capabilities';

const facade = await WalletFacade.init({
  configuration: {
    networkId,
    indexerClientConnection: { indexerHttpUrl, indexerWsUrl },
    provingServerUrl: new URL(provingServerUrl),
    relayURL: new URL(nodeWsUrl),
    costParameters: { feeBlocksMargin: 5 },
    txHistoryStorage: new InMemoryTransactionHistoryStorage(),
  },
  shielded: (cfg) => ShieldedWallet(cfg).startWithSeed(derivation.keys[Roles.Zswap]),
  unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
  dust: (cfg) => DustWallet(cfg).startWithSeed(
    derivation.keys[Roles.Dust],
    ledger.LedgerParameters.initialParameters().dust,
  ),
  provingService: () => makeServerProvingService({ provingServerUrl: new URL(provingServerUrl) }),
});
```

### Step 4: Start the facade (SEPARATE STEP)

```typescript
await facade.start(shieldedSecretKeys, dustSecretKey);
```

**Trap:** `WalletFacade.init()` does NOT start the wallet. You MUST call `.start()` separately. Missing this = wallet never syncs, no state updates, no errors — just silence.

### Step 5: Subscribe to state

```typescript
facade.state().subscribe((facadeState) => {
  // facadeState contains shielded, unshielded, dust subsystem states
  // This fires on every state change (sync progress, balance updates, etc.)
});
```

**Reference:** `gsd-wallet/src/background/walletManager.ts:initializeWallet`

---

## 4. Platform-Specific Gotchas

### Chrome Extension (MV3)

#### Polyfills required in service worker

The service worker has no Node.js APIs and no DOM. Three polyfills are mandatory:

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

// 3. DOM globals (for Vite modulepreload and SDK deps that call document.createElement)
if (typeof document === 'undefined') {
  const noop = () => {};
  const noopEl = { setAttribute: noop, appendChild: noop, removeChild: noop, getAttribute: () => null, nonce: '' };
  (globalThis as Record<string, unknown>)['document'] = {
    addEventListener: noop, removeEventListener: noop,
    createElement: () => ({ ...noopEl, onload: null, onerror: null, rel: '', href: '', crossOrigin: '' }),
    head: { ...noopEl }, documentElement: { ...noopEl },
    getElementsByTagName: () => [], querySelector: () => null, querySelectorAll: () => [],
  };
}
if (typeof window === 'undefined') {
  (globalThis as Record<string, unknown>)['window'] = globalThis;
}
```

These must be at the TOP of your service worker entry point, before any SDK imports.

**Reference:** `gsd-wallet/src/background/index.ts`

#### Manifest CSP for WASM

```json
"content_security_policy": {
  "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
}
```

Without `wasm-unsafe-eval`, the ledger WASM module will fail to instantiate with no useful error message.

#### Service worker keepalive

Chrome terminates idle service workers after ~30 seconds. The wallet needs to stay alive during sync:

```typescript
chrome.alarms.create('keepalive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener(() => { /* no-op */ });
```

Clear the alarm when the wallet is stopped.

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

| Subsystem | Applied field | Highest field | Connected field |
|-----------|--------------|---------------|-----------------|
| Shielded | `appliedIndex` | `highestRelevantWalletIndex` | `isConnected` |
| Unshielded | `appliedId` | `highestTransactionId` | `isConnected` |
| Dust | `appliedIndex` | `highestRelevantWalletIndex` | `isConnected` |

**Trap:** `highestRelevantWalletIndex === 0` does NOT mean "synced at block 0". It means the indexer hasn't determined the highest relevant index yet. You must also check `highestIndex` (the global chain tip) to distinguish "nothing relevant yet" from "not connected yet".

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

**Reference:** `gsd-wallet/src/background/walletManager.ts:serializeState`

---

## 6. DApp Connector Implementation

If building a wallet that injects into web pages (Chrome extension or Electron):

### Architecture

```
Page (main world)          Content Script (isolated)       Service Worker
  inpage.js                  content-script.ts               messageRouter.ts
  window.midnight[uuid]  ←→  persistent port bridge     ←→  connectedApiHandler.ts
```

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

When Chrome restarts the service worker, `autoUnlock` reinitializes the wallet. API handlers must wait for this to complete:

```typescript
// In your API handler, before using the facade:
await walletManager.waitForReady();
```

Without this, API calls can hit a dead or partially-initialized facade and hang indefinitely.

**Reference:** `gsd-wallet/src/background/walletManager.ts:waitForReady`, `gsd-wallet/src/background/connectedApiHandler.ts`

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

## 9. Common Failure Modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| Wallet hangs on "Initializing" | `WalletFacade.init()` is waiting for node WebSocket connection | Respond to UI immediately after storing the wallet; run facade init in background |
| State updates continue after clearing wallet | Old facade RxJS subscription still emitting | Guard state handler: ignore updates when `hasVault === false` |
| `TypeError: Do not know how to serialize a BigInt` | BigInt passed through `postMessage` or `JSON.stringify` | Convert to string at every IPC boundary |
| Address shows as empty string | `MidnightBech32m.encode()` threw (address not yet synced) | Wrap in try-catch, show placeholder |
| UTXO hash "Not found in indexer" | `intentHash` is not a transaction hash | Don't use intent hash as indexer lookup key |
| Popup scrolls past bottom | Chrome enforces viewport height limit (~600px) | Cap popup height; offer "Open in Full Tab" |
| Service worker dies mid-operation | Chrome kills idle SWs after ~30s | Use `chrome.alarms` keepalive + persistent ports |
| API call hangs after SW restart | `autoUnlock` reinitializes facade while API handler uses old ref | Gate API handlers with `waitForReady()` before using facade |
| `balanceUnboundTransaction` hangs | Facade balance method blocks indefinitely for some contract txs | Under investigation — diagnostics panel helps trace the exact stall point |
| `HDWallet.fromSeed` returns but wallet fails later | Didn't check `.type === 'seedOk'` | Always check tagged return types |
| Facade created but never syncs | Forgot to call `facade.start()` after `init()` | `.init()` and `.start()` are separate steps |
| DApps can't discover wallet | Missing `midnight#ready` event dispatch | Dispatch `CustomEvent('midnight#ready')` after injection |
| `dust.balance` throws | Called as property instead of method, or dust not synced | Call as `dust.balance(new Date())` in try-catch |

---

## 10. Documentation Gap Analysis

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
| **Keepalive patterns** | — | — | **Gap** — SW lifecycle not addressed |

---

## 11. Reference Implementation

The GSD Wallet provides working implementations of every pattern in this guide:

| Pattern | File | Key function/section |
|---------|------|---------------------|
| Service worker polyfills | `src/background/index.ts` | Lines 1-38 |
| Facade initialization | `src/background/walletManager.ts` | `initializeWallet()` |
| SW race condition guard | `src/background/walletManager.ts` | `waitForReady()` |
| State serialization | `src/background/walletManager.ts` | `serializeState()` |
| Diagnostic event logger | `src/background/diagnosticLogger.ts` | `emit()`, `getBacklog()`, `onEvent()` |
| Diagnostic event broadcasting | `src/background/messageRouter.ts` | `onEvent` → `DIAGNOSTIC_EVENT` to ports |
| Message protocol types | `src/shared/messages.ts` | `PopupRequest`, `PopupResponse` |
| DApp connector (inpage) | `src/content-script/inpage.ts` | Full file (120s timeout) |
| Content script bridge | `src/content-script/content-script.ts` | Full file |
| DApp API handler | `src/background/connectedApiHandler.ts` | `handleApiCall()` with structured emit |
| Explorer GraphQL queries | `src/shared/indexerQuery.ts` | `fetchTxDetail()`, `fetchBlockDetail()`, `fetchContractDetail()` |
| Diagnostics panel UI | `src/popup/components/DiagnosticsPanel.tsx` | Filters, auto-scroll, expand/collapse |
| Environment configuration | `src/shared/environments.ts` | `ENVIRONMENTS` map |
| Async wallet creation | `src/background/messageRouter.ts` | `ADD_WALLET` case |
| Clear wallet with state guard | `src/popup/hooks/useWalletState.ts` | `hasVault !== false` guard |
| Chrome manifest (MV3 + WASM) | `manifest.json` | Full file |

Repository: `https://github.com/adamreynolds-io/gsd-wallet`

---

## 12. Audit Findings (GSD Wallet v0.1.0)

Code audit performed 2026-03-28 against wallet-sdk v3.0.0 documentation.

### Correct implementations

| Area | Status |
|------|--------|
| HD key derivation (tagged union checks, memory cleanup) | Correct |
| WalletFacade two-step init (init + start) | Correct |
| State serialization (BigInt, address encoding, sync progress) | Correct |
| Balance map iteration (all token types, not just NIGHT) | Correct |
| DApp connector API (18 methods, BigInt serialization, session TTL) | Correct |
| `NIGHT_TOKEN_ID` hardcoding | Correct (equivalent to `ledger.unshieldedToken().raw`) |

### Bug found and fixed

**`core/transfer.ts:74-85` — conditional signing on internal transfer path.** The internal UI transfer code only signed when `tokenType === 'unshielded'`, skipping signing for shielded transfers. The DApp connector path (`connectedApiHandler.ts:308-317`) correctly signs unconditionally. **Fixed:** signing now runs whenever `unshieldedKeystore` is available, matching the DApp path and SDK examples.

### Not implemented (documented in SDK)

| SDK feature | Status in GSD wallet |
|-------------|---------------------|
| `facade.initSwap()` | Not implemented |
| `facade.estimateRegistration()` | Not implemented |
| `facade.waitForSyncedState()` | Not implemented |
| `getTxHistory()` DApp API | Returns empty array (stub) |
| Transaction history (shielded/dust) | SDK notes: "not yet implemented" in SDK itself |

### Minor deviations (acceptable)

- Uses `ShieldedWallet(cfg).startWithSeed()` instead of `startWithSecretKeys()` — both are valid API entry points documented in the SDK
- Same for `DustWallet(cfg).startWithSeed()` vs `startWithSecretKey()`
