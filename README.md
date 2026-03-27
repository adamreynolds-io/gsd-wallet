# Midnight GSD Wallet

Developer/QA wallet Chrome extension for the [Midnight](https://midnight.network) blockchain. Built for testing, debugging, and dApp development — not for production use.

## Features

- **Wallet management** — generate (24-word mnemonic) or import (seed phrase, hex seed) wallets
- **Multi-environment** — Mainnet, Mainnet VPN, PreProd, Preview, QANet, DevNet, Undeployed (local)
- **Multi-wallet** — multiple wallets per environment with quick-switch
- **Shielded & unshielded transfers** — send tokens with ZK proving via server prover
- **Dust operations** — register/deregister UTXOs for dust generation
- **DApp connector** — implements `@midnight-ntwrk/dapp-connector-api` v4.0.1 with `window.midnight` injection
- **Debug panel** — real-time sync progress, coin counts, UTXO inspection, token balances per subsystem (Dust/Shielded/Unshielded)
- **Built-in explorer** — query the v4 indexer directly for transaction, block, and contract details without leaving the wallet
- **Transaction history** — records transfers and dust operations with clickable tx hashes
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

**Popup mode** — click the extension icon for a compact 780x600 view.

**Full tab mode** — click the expand icon in the header for a larger view with more explorer space.

**Localnet** — select "Undeployed" environment and use the W0-W3 buttons to quick-import prefunded genesis wallets.

**Mainnet VPN** — select "Mainnet (VPN)" to connect via `td-rpc.mainnet.midnight.network`. Requires VPN access.

**Explorer** — type a transaction hash, block height, or contract address in the search field. The wallet auto-detects the type: numbers are block lookups, 64-char hex strings try transaction first then fall back to contract.

**Custom endpoints** — Settings page allows overriding Node, Indexer, and Prover URLs per environment.

## Architecture

```
src/
  background/           Service worker (wallet lifecycle, message routing)
    index.ts            SW entry, polyfills, keepalive
    walletManager.ts    WalletFacade init, state serialization, key management
    stateManager.ts     Vault persistence, wallet switching, session management
    messageRouter.ts    Popup + dApp message dispatch, tx history recording
    connectedApiHandler.ts  DApp connector API implementation (18 methods)
  popup/                React UI
    App.tsx             Router, layout shell
    pages/
      Dashboard.tsx     Main view (wallet + debug + explorer)
      Onboarding.tsx    Wallet creation/import flow
      Settings.tsx      Network configuration
      Unlock.tsx        Auto-unlock
    components/
      Header.tsx        Logo, network selector, wallet switcher
      Inspector.tsx     Explorer detail views (tx/block/contract)
      Modal.tsx         Generic modal
      TransferModal.tsx Transfer flow (7 steps)
      DustModal.tsx     Dust registration/deregistration
      AddressDisplay.tsx Address with copy
      StepIndicator.tsx Step progress bar
    store/
      popupStore.ts     Zustand state
    hooks/
      useWalletState.ts Service worker connection
  content-script/       DApp bridge
    content-script.ts   Persistent port bridge (content world)
    inpage.ts           window.midnight API (main world)
    inpage.js           Plain JS copy for injection
  core/                 Business logic
    transfer.ts         Shielded/unshielded transfer execution
    dustRegistration.ts Dust registration
    dustDeregistration.ts Dust deregistration
    addressValidation.ts Address parsing
    balanceUtils.ts     Balance formatting
    wallet.ts           Key derivation utilities
  shared/               Cross-layer types and utilities
    types.ts            TypeScript interfaces
    messages.ts         Message protocol (popup + dApp)
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

Dispatches `midnight#ready` event for dApp discovery. 30-second request timeout on all API calls.

**Connected API methods:** `getShieldedBalances`, `getUnshieldedBalances`, `getDustBalance`, `getShieldedAddresses`, `getUnshieldedAddress`, `getDustAddress`, `getConfiguration`, `getConnectionStatus`, `makeTransfer`, `balanceUnsealedTransaction`, `balanceSealedTransaction`, `submitTransaction`, `signData`, `getTxHistory`, `hintUsage`.

## Explorer queries

The built-in explorer queries the v4 indexer GraphQL API directly:

| Search input | Lookup |
|---|---|
| Number (e.g. `121972`) | Block by height |
| 64-char hex | Transaction by hash, falls back to contract by address |

Results show status, block info, fees, contract actions, created/spent UTXOs with clickable sub-navigation.

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

Internal development tool. Not for distribution.
