# Midnight GSD Wallet

Chrome extension wallet for dApp developers building on the [Midnight](https://midnight.network) blockchain. Designed for testing and debugging on Undeployed (local), DevNet, QANet, Preview, PreProd, and Mainnet environments.

**This is not a production wallet.** Seeds are stored unencrypted. Use it to develop and test your dApps, not to hold real funds.

## Who is this for?

- **dApp developers** testing contract deployments, token transfers, and DApp connector integration
- **QA engineers** verifying wallet behavior across Midnight environments
- **SDK integrators** building their own Midnight wallet (see [Integration Guide](docs/WALLET-INTEGRATION-GUIDE.md))

## Features

- **Multi-environment** — Undeployed (localhost), DevNet, QANet, Preview, PreProd, Mainnet
- **Quick-start on localnet** — one-click import of 4 prefunded genesis wallets (W0-W3)
- **Wallet management** — generate 24-word mnemonic or import seed phrase / hex seed
- **Multi-wallet** — multiple wallets per environment with quick-switch
- **Shielded & unshielded transfers** — send tokens with ZK proving via server prover
- **Dust operations** — register/deregister UTXOs for dust generation
- **DApp connector** — `window.midnight` injection implementing the Midnight DApp connector API
- **Debug panel** — real-time sync progress, UTXO inspection, token balances per subsystem (Dust/Shielded/Unshielded)
- **Built-in explorer** — query the v4 indexer for transaction, block, and contract details
- **Diagnostics** — structured event stream from the service worker with filterable log levels
- **Custom endpoints** — override Node, Indexer, and Prover URLs per environment

## Quick start

```bash
npm install
npm run build
```

Load in Chrome: `chrome://extensions` → Developer mode → Load unpacked → select `dist/`

**Recommended:** Click the expand icon (↗) in the header to open in a full browser tab. The popup works but the full-tab view gives you much more space for the debug panel, explorer, and diagnostics.

### Localnet setup

1. Start local infrastructure (node + indexer + proof server)
2. Select "Undeployed" environment in the wallet
3. Click W0 to import the genesis wallet with all minted NIGHT
4. Deploy and test your contracts

### Testnet setup

1. Start a proof server: `docker run -d -p 6300:6300 ghcr.io/midnight-ntwrk/proof-server:8.0.2 midnight-proof-server -v`
2. Select your target network (DevNet, QANet, Preview, PreProd)
3. Import your funded wallet seed
4. Your dApp can discover the wallet via `window.midnight`

## DApp connector

The wallet injects `window.midnight[uuid]` on all pages and dispatches `midnight#ready` for discovery.

**17 API methods:** `getShieldedBalances`, `getUnshieldedBalances`, `getDustBalance`, `getShieldedAddresses`, `getUnshieldedAddress`, `getDustAddress`, `getConfiguration`, `getConnectionStatus`, `makeTransfer`, `balanceUnsealedTransaction`, `balanceSealedTransaction`, `submitTransaction`, `signData`, `getTxHistory`, `hintUsage`, `getProvingProvider`, `makeIntent`.

`getTxHistory` returns `[]` (stub). `getProvingProvider` and `makeIntent` return errors — use `getConfiguration()` for prover URL.

## Explorer

Type a transaction hash, block height, or contract address in the search field:

| Input | Lookup |
|-------|--------|
| Number (e.g. `121972`) | Block by height |
| 64-char hex | Transaction by hash → falls back to contract |

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

## Known issues

- **Segment ID collision in DApp transaction balancing** — [#10](https://github.com/adamreynolds-io/gsd-wallet/issues/10)

## Documentation

- [Integration Guide](docs/WALLET-INTEGRATION-GUIDE.md) — for AI agents and developers building Midnight wallets
- [SDK Reference](docs/sdk-reference/) — wallet-sdk v3.0.0 architecture, package APIs, code examples

## Scripts

| Command | Description |
|---|---|
| `npm run build` | TypeScript check + Vite production build |
| `npm run dev` | Vite dev server with HMR |
| `npm run typecheck` | TypeScript `--noEmit` check |
| `npm run preview` | Vite preview server |

## Dependencies

| Category | Packages |
|---|---|
| Midnight SDK | `wallet-sdk-facade`, `wallet-sdk-hd`, `ledger-v8`, `dapp-connector-api` |
| UI | React 18, React Router 7, Zustand 5, TailwindCSS 3 |
| Storage | `idb` (IndexedDB), RxJS 7 |
| Build | Vite 6, `@crxjs/vite-plugin`, TypeScript 5.9 |
| Crypto | `@scure/bip39` |

## License

Apache License 2.0. See [LICENSE](LICENSE).
