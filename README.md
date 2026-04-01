# G.S.D. Wallet

There was a [bug](https://github.com/adamreynolds-io/gsd-wallet/issues/10), so I built this...then people liked it and it took on a life of its own. My pain is your gain. If you're developing on Midnight, then this is the best wallet for you.

<p align="center">
  <img src="docs/gsd-wallet.png" alt="GSD Wallet — full-tab dashboard showing balances, UTXOs, explorer, and real-time diagnostic events" width="900" />
</p>

Chrome extension wallet for dApp developers building on the [Midnight](https://midnight.network) blockchain. Designed for testing and debugging on Undeployed (local), DevNet, QANet, Preview, PreProd, and Mainnet environments.

**This is not a production wallet.** Seeds are stored unencrypted. Use it to develop and test your dApps, not to hold real funds.

A personal project by [Adam Reynolds](https://github.com/adamreynolds-io), Engineering Manager, Platform & Tooling @ [Shielded Technologies](https://shielded.io).

## Who is this for?

- **dApp developers** testing contract deployments, token transfers, and DApp connector integration
- **QA engineers** verifying wallet behavior across Midnight environments
- **SDK integrators** building their own Midnight wallet (see [Integration Guide](docs/WALLET-INTEGRATION-GUIDE.md))

## Install

**Option A — pre-built (recommended):**

Download `dist.zip` from the [latest release](https://github.com/adamreynolds-io/gsd-wallet/releases/latest), unzip, go to `chrome://extensions`, enable Developer Mode, click "Load unpacked", select the `dist/` folder.

**Option B — build from source:**

```bash
npm install
npm run build
```

Load `dist/` as above.

## Features

- **Multi-environment** — Undeployed (localhost), DevNet, QANet, Preview, PreProd, Mainnet
- **Wallet menu** — unified dropdown with wallets grouped by network, create/switch/delete/copy-seed
- **Quick-start on localnet** — one-click genesis wallets (W0-W3) with prefunded NIGHT
- **Multi-wallet** — multiple wallets per environment, each with isolated sync state and indexed names
- **Shielded & unshielded transfers** — send tokens with ZK proving via server prover
- **Dust operations** — register/deregister UTXOs for dust generation
- **DApp connector** — `window.midnight` injection implementing the Midnight DApp connector API
- **Custom endpoints** — override Node, Indexer, and Prover URLs per environment

### Sync & diagnostics

- **Non-blocking sync** — UI renders immediately while the wallet syncs in the background
- **Per-wallet sync progress** — Shielded/Unshielded/Dust progress in the status bar and debug tabs
- **Sync phase in header** — Connecting/Syncing X%/Stalled/Synced displayed next to the wallet name
- **Stall detection** — automatic detection when sync stops advancing for 30s
- **SDK console interception** — captures `@polkadot/api` RPC-CORE errors and WebSocket disconnects
- **Persistent diagnostics** — 2000-event ring buffer in the SW persisted to `chrome.storage.session`; offscreen diagnostics kept in-memory (persistent document)
- **Filterable event stream** — filter by level (DBG/INF/WRN/ERR) and category (SW/Wallet/State/Sync/SDK/DApp/API/Pop/Tx/Idx/Sto/Err)
- **Log export** — download all diagnostic events as NDJSON with ISO timestamps
- **Debug tabs** — real-time sync progress, UTXO inspection, token balances per subsystem, transaction history
- **Built-in explorer** — query the v4 indexer for transaction, block, and contract details
- **Shared event cache** — network events cached in IndexedDB, shared across wallets on the same network
- **Bundled mainnet snapshot** — 88k pre-built events for zero-download first sync
- **Cache export** — download event cache as NDJSON for sharing or backup

## Architecture

```
DApp <-> content script <-> service worker (23KB) <-> offscreen relay (800B) <-> Web Worker (1.7MB SDK)
```

The SDK runs in a **Web Worker** spawned by an offscreen document. Chrome does not monitor Workers for responsiveness, so heavy SDK operations (balancing, proving) never trigger "Page Unresponsive" dialogs.

| Component | Role |
|-----------|------|
| **Service worker** | Thin message router — popup/dApp port management, session handling, state caching |
| **Offscreen document** | Stateless relay between SW port and Worker via `postMessage` |
| **Web Worker** | Hosts WalletFacade, all SDK operations, sync, checkpoints, diagnostics |

The offscreen document initiates the port connection to the SW. When Chrome restarts the SW, the offscreen detects the disconnect and reconnects automatically. The Worker (and SDK state) survives SW restarts.

### Persistent SDK storage

SDK wallet state is checkpointed to IndexedDB on sync completion and wallet stop. On browser restart, the wallet restores from checkpoint and resumes syncing from the last saved position.

Network events (shielded ZSwap and dust events) are cached in IndexedDB per-network and shared across all wallets on the same network. A bundled mainnet cache snapshot (88k events) ships with the extension — imported into IndexedDB in ~5s on first install, eliminating the network download for cached events.

The offscreen document is persistent — Chrome does not garbage-collect it. No keepalive hacks are needed.

## How sync works

The wallet syncs three subsystems independently:

| Subsystem | What it syncs | Why |
|-----------|--------------|-----|
| **Shielded** | All ZSwap events on chain | Privacy — wallet filters locally so the indexer never sees your viewing keys |
| **Unshielded** | Only your transactions | Public — indexer can filter by address without privacy risk |
| **Dust** | All dust events on chain | Same privacy model as shielded — local filtering |

**First sync is slow on mainnet** (~89k shielded + ~89k dust events), but a bundled cache snapshot ships with the extension — fresh install syncs from local cache in ~3 min instead of 6+ min from the indexer. The unshielded subsystem syncs instantly.

Two-phase initialization ensures the UI is never blocked:
1. **Phase 1 (fast):** Load checkpoint, create facade, subscribe to state, emit initial state to UI
2. **Phase 2 (background):** `facade.start()` connects to indexer/node, sync resumes; state updates flow progressively

## Quick start

### Localnet

1. Start local infrastructure (node + indexer + proof server)
2. Select "Undeployed" environment
3. Click W0 to import the genesis wallet with all minted NIGHT
4. Deploy and test your contracts

### Testnet / Mainnet

1. Start a proof server: `docker run -d -p 6300:6300 ghcr.io/midnight-ntwrk/proof-server:8.0.2 midnight-proof-server -v`
2. Select your target network
3. Import your funded wallet seed
4. Your dApp can discover the wallet via `window.midnight`

**Tip:** Click the expand icon in the header to open in a full browser tab.

## DApp connector

The wallet injects `window.midnight[uuid]` on all pages and dispatches `midnight#ready` for discovery.

**17 API methods:** `getShieldedBalances`, `getUnshieldedBalances`, `getDustBalance`, `getShieldedAddresses`, `getUnshieldedAddress`, `getDustAddress`, `getConfiguration`, `getConnectionStatus`, `makeTransfer`, `balanceUnsealedTransaction`, `balanceSealedTransaction`, `submitTransaction`, `signData`, `getTxHistory`, `hintUsage`, `getProvingProvider`, `makeIntent`.

## Explorer

| Input | Lookup |
|-------|--------|
| Number (e.g. `121972`) | Block by height |
| 64-char hex | Transaction by hash, falls back to contract |

## Network configuration

| Environment | Node RPC | Indexer |
|---|---|---|
| Undeployed | `localhost:9944` | `localhost:8088/api/v4/graphql` |
| DevNet | `rpc.devnet.midnight.network` | `indexer.devnet.midnight.network/api/v4/graphql` |
| QANet | `rpc.qanet.midnight.network` | `indexer.qanet.midnight.network/api/v4/graphql` |
| Preview | `rpc.preview.midnight.network` | `indexer.preview.midnight.network/api/v4/graphql` |
| PreProd | `rpc.preprod.midnight.network` | `indexer.preprod.midnight.network/api/v4/graphql` |
| Mainnet | `rpc.mainnet.midnight.network` | `indexer.mainnet.midnight.network/api/v4/graphql` |

Proof server: `localhost:6300` for all environments.

## Security

Intentional trade-offs for developer convenience:

| Area | Status |
|---|---|
| Seed storage | Plaintext in IndexedDB — do not use for real funds |
| Password protection | Disabled |
| DApp connections | Auto-approved, no user confirmation |
| CSP | `wasm-unsafe-eval` required for Midnight SDK WASM |

Seed material is zeroed after use in the Worker. Wallet IDs are derived from SHA-256 of the seed (never raw seed bytes in logs or storage keys).

## Known issues

- **Contract call transactions fail in Chrome** — `balanceUnsealedTransaction` fails with `IntentSegmentIdCollision` for contract call transactions in the Chrome extension context. The same code path succeeds in Node.js. Deploy transactions work fine. This is an upstream SDK/ledger issue — no workaround exists for dApp developers. See [#45](https://github.com/adamreynolds-io/gsd-wallet/issues/45).
- **Mainnet RPC disconnects** — The mainnet RPC node periodically drops WebSocket connections with `1000: Normal Closure`. The SDK reconnects automatically but sync can stall temporarily.
- **First mainnet sync takes ~3 min** — ~89k shielded + ~89k dust events are replayed from the bundled cache snapshot (was 6+ min from indexer). Subsequent opens resume from per-wallet checkpoints.

## Documentation

- [Integration Guide](docs/WALLET-INTEGRATION-GUIDE.md) — lessons learned building this wallet, platform constraints, SDK gaps
- [SDK Reference](docs/sdk-reference/) — wallet-sdk v3.0.0 architecture, package APIs, code examples

## Dependencies

| Category | Packages |
|---|---|
| Midnight SDK | `wallet-sdk-facade` 3.0.0, `wallet-sdk-hd` 3.0.1, `ledger-v8` 8.0.3, `dapp-connector-api` 4.0.1 |
| UI | React 19, React Router 7, Zustand 5, Tailwind CSS 4 |
| Storage | `idb` (IndexedDB), RxJS 7 |
| Build | Vite 8, `@crxjs/vite-plugin` 2.4.0, TypeScript 6 |
| Crypto | `@scure/bip39` |

## License

Apache License 2.0. See [LICENSE](LICENSE).
