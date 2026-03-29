# Midnight GSD Wallet

Developer/QA wallet Chrome extension for the [Midnight](https://midnight.network) blockchain. **Get Stuff Debugged** — built for testing, debugging, and dApp development, not for production use.

## Features

- **Wallet management** — generate (24-word mnemonic) or import (seed phrase, hex seed) wallets
- **Multi-environment** — Mainnet, Mainnet VPN, PreProd, Preview, QANet, DevNet, Undeployed (local)
- **Multi-wallet** — multiple wallets per environment with quick-switch
- **Shielded & unshielded transfers** — send tokens with ZK proving via server prover
- **Dust operations** — register/deregister UTXOs for dust generation
- **DApp connector** — implements `@midnight-ntwrk/dapp-connector-api` v4.0.1 with `window.midnight` injection
- **Debug panel** — real-time sync progress, coin counts, UTXO inspection, token balances per subsystem (Dust/Shielded/Unshielded)
- **Built-in explorer** — query the v4 indexer for transaction, block, and contract details with forward/back navigation
- **Real-time diagnostics panel** — structured event stream from the service worker with:
  - Log levels (debug/info/warn/error) and categories (sw/wallet/state/dapp/api/popup/tx/indexer/storage/error)
  - Checkbox filters for granular control — retroactive filtering hides/shows historical events
  - All/None toggle, per-event expand/collapse (+/−), global expand/collapse all
  - Auto-scroll with jump-to-bottom button when scrolled up
  - Per-event copy and copy-all (respects active filters) as JSON
  - Every wallet lifecycle event, facade init/start/stop, state transitions, dApp API calls, and transaction phases with elapsed times
- **Transaction history** — records transfers and dust operations with clickable tx hashes
- **Service worker race protection** — API handlers wait for initialization to complete before using the facade
- **120-second request timeout** — long enough for proving-heavy operations
- **Midnight style guide** — official color palette, Outfit font, Midnight logo

## Quick start

```bash
# Install dependencies
npm install

# Build the extension
npm run build

# Load in Chrome
# 1. Go to chrome://extensions
# 2. Enable Developer mode
# 3. Click "Load unpacked"
# 4. Select the dist/ directory
```

## Usage

**Popup mode** — click the extension icon for a compact view with wallet info, debug tabs, explorer, and diagnostics side by side.

**Full tab mode** — click the expand icon in the header for a larger view. Bottom half splits into Explorer (left) and Diagnostics (right).

**Localnet** — select "Undeployed" environment and use the W0-W3 buttons to quick-import prefunded genesis wallets.

**Mainnet VPN** — select "Mainnet (VPN)" to connect via `td-rpc.mainnet.midnight.network`. Requires VPN access.

**Explorer** — type a transaction hash, block height, or contract address in the search field. Numbers are block lookups, hex strings try transaction first then fall back to contract. Use ← → buttons for navigation history.

**Diagnostics** — the events panel streams all wallet operations in real time. Use the checkbox filters to show/hide specific log levels or event categories. Expand events with the + button to see full payloads. Copy individual events or all visible events as JSON.

**Custom endpoints** — Settings page allows overriding Node, Indexer, and Prover URLs per environment.

## Architecture

```
src/
  background/           Service worker (wallet lifecycle, message routing)
    index.ts            SW entry, polyfills, keepalive
    walletManager.ts    WalletFacade init, state serialization, key management
    stateManager.ts     Vault persistence, wallet switching, session management
    messageRouter.ts    Popup + dApp message dispatch, diagnostic broadcasting
    connectedApiHandler.ts  DApp connector API implementation (18 methods)
    diagnosticLogger.ts Ring buffer event logger with structured levels/categories
  popup/                React UI
    App.tsx             Router, layout shell
    pages/
      Dashboard.tsx     Main view (wallet + debug + explorer + diagnostics)
      Onboarding.tsx    Wallet creation/import flow
      Settings.tsx      Network configuration
      Unlock.tsx        Auto-unlock
    components/
      Header.tsx        Logo, network selector, wallet switcher
      Inspector.tsx     Explorer detail views (tx/block/contract)
      DiagnosticsPanel.tsx Real-time event stream with filters
      Modal.tsx         Generic modal
      TransferModal.tsx Transfer flow (7 steps)
      DustModal.tsx     Dust registration/deregistration
      AddressDisplay.tsx Address with copy
      StepIndicator.tsx Step progress bar
    store/
      popupStore.ts     Zustand state (wallet + diagnostics)
    hooks/
      useWalletState.ts Service worker connection + diagnostic backlog
  content-script/       DApp bridge
    content-script.ts   Persistent port bridge (content world)
    inpage.ts           window.midnight API (main world, 120s timeout)
    inpage.js           Plain JS copy for injection
  core/                 Business logic
    transfer.ts         Shielded/unshielded transfer execution
    dustRegistration.ts Dust registration
    dustDeregistration.ts Dust deregistration
    addressValidation.ts Address parsing
    balanceUtils.ts     Balance formatting
    wallet.ts           Key derivation utilities
  shared/               Cross-layer types and utilities
    types.ts            TypeScript interfaces (wallet state + diagnostic events)
    messages.ts         Message protocol (popup + dApp + diagnostics)
    environments.ts     Network configs, explorer URLs
    indexerQuery.ts     GraphQL queries (v4 indexer)
    storage.ts          IndexedDB wrapper
    constants.ts        Token IDs, denominations
    errors.ts           Error types
    crypto.ts           PBKDF2 + AES-256-GCM (unused, for future encryption)
  offscreen/            Reserved for Phase 3 WASM prover
```

## DApp connector API

The wallet injects `window.midnight[uuid]` on all pages with:

```typescript
{
  rdns: 'io.shielded.gsd',
  name: 'Midnight GSD Wallet',
  apiVersion: '4.0.1',
  connect(networkId: string): Promise<ConnectedAPI>
}
```

Dispatches `midnight#ready` event for dApp discovery. 120-second request timeout on all API calls.

**Connected API methods:** `getShieldedBalances`, `getUnshieldedBalances`, `getDustBalance`, `getShieldedAddresses`, `getUnshieldedAddress`, `getDustAddress`, `getConfiguration`, `getConnectionStatus`, `makeTransfer`, `balanceUnsealedTransaction`, `balanceSealedTransaction`, `submitTransaction`, `signData`, `getTxHistory`, `hintUsage`.

## Diagnostics

The diagnostics panel streams structured events from the service worker in real time. Events are categorized by level and source:

| Category | What it captures |
|---|---|
| `sw` | Service worker lifecycle (start, install, update) |
| `wallet` | Wallet init, HD key derivation, facade start/stop |
| `state` | Sync status transitions (initializing → syncing → synced) |
| `dapp` | DApp connect/disconnect, session management |
| `api` | Every DApp API call with method name, elapsed time |
| `popup` | Popup message handling |
| `tx` | Transaction phases: deserialize → balance → sign → prove → submit |
| `indexer` | GraphQL queries to the indexer |
| `storage` | IndexedDB operations |
| `error` | Errors at any layer |

Events include elapsed time for async operations, raw payloads in expandable details, and segment IDs for transaction inspection.

## Explorer queries

The built-in explorer queries the v4 indexer GraphQL API directly:

| Search input | Lookup |
|---|---|
| Number (e.g. `121972`) | Block by height |
| 64-char hex | Transaction by hash, falls back to contract by address |

Results show status, block info, fees, contract actions, created/spent UTXOs with clickable sub-navigation. Forward/back buttons for navigation history.

## Security considerations

This is a **developer wallet** with intentional trade-offs for convenience:

| Area | Status | Notes |
|---|---|---|
| Seed storage | Plaintext in IndexedDB | Crypto module exists but is not wired up. Do not use for real funds. |
| Password protection | Disabled | Infrastructure exists (`VaultData`, PBKDF2) but bypassed for fast dev access |
| DApp connections | Auto-approve | No origin validation or user confirmation prompts |
| Content script | Basic filtering | Checks `event.source` but no protocol blocking |
| CSP | `wasm-unsafe-eval` | Required for Midnight SDK WASM modules |
| Key wiping | Not implemented | Keys stay in memory until wallet is locked or SW terminates |

The UI displays a warning banner: **"Dev wallet — seeds unencrypted"**.

## Network configuration

| Environment | Node RPC | Indexer | Explorer |
|---|---|---|---|
| Mainnet | `rpc.mainnet.midnight.network` | `indexer.mainnet.midnight.network/api/v4` | `explorer.mainnet.midnight.network` |
| Mainnet VPN | `td-rpc.mainnet.midnight.network` | Same as mainnet | Same as mainnet |
| PreProd | `rpc.preprod.midnight.network` | `indexer.preprod.midnight.network/api/v4` | `explorer.preprod.midnight.network` |
| Preview | `rpc.preview.midnight.network` | `indexer.preview.midnight.network/api/v4` | `explorer.preview.midnight.network` |
| QANet | `rpc.qanet.midnight.network` | `indexer.qanet.midnight.network/api/v4` | `explorer.qanet.midnight.network` |
| DevNet | `rpc.devnet.midnight.network` | `indexer.devnet.midnight.network/api/v4` | `explorer.devnet.midnight.network` |
| Undeployed | `localhost:9944` | `localhost:8088/api/v4` | — |

Proof server: `localhost:6300` (all environments).

## Known issues

- **Segment ID collision in DApp transaction balancing** — [#10](https://github.com/adamreynolds-io/gsd-wallet/issues/10). `balanceUnsealedTransaction` can fail with `IntentSegmentIdCollision`. Works in Lace and the test harness, so likely an integration issue in GSD wallet. Retry workaround in place.

## Dependencies

- **Midnight SDK**: `wallet-sdk-facade`, `wallet-sdk-hd`, `wallet-sdk-shielded`, `wallet-sdk-unshielded-wallet`, `wallet-sdk-dust-wallet`, `wallet-sdk-capabilities`, `wallet-sdk-address-format`, `ledger-v8`
- **UI**: React 18, React Router 7, Zustand 5, TailwindCSS 3
- **Build**: Vite 6, `@crxjs/vite-plugin` (MV3), TypeScript 5.9
- **Crypto**: `@scure/bip39` (mnemonic generation)

## Scripts

| Command | Description |
|---|---|
| `npm run build` | TypeScript check + Vite production build |
| `npm run dev` | Vite dev server with HMR |
| `npm run typecheck` | TypeScript `--noEmit` check |

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.
