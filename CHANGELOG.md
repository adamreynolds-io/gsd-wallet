# Changelog

## 0.9.0

- **DApp connector routing** — socket DAPP_REQUESTs now route through `handleDappRequest()`, sharing session tracking, validation, and logging with browser dApps
- **Failed TX download** — download raw tx bytes as `.bin` from the diagnostics panel when a transaction fails
- **TX heartbeat** — 10s liveness heartbeats during long-running operations; pauses during CPU-bound WASM steps
- **Persistent diagnostics** — events stored in `chrome.storage.local`, surviving extension reloads and SW restarts
- **Diagnostics search** — text filter across event messages and JSON data (3-char min, debounced)
- **Real-world example** — `packages/gsd-socket/example.ts` deploys a counter contract via GSD Connect (proven working)
- **Review fixes** — hex validation, BigInt safety, session cleanup on wallet switch, concurrent connect guard, WebSocket error handler, connection timeout
- **Branding** — header updated to "Midnight G.S.D. Wallet"
- **Custom WASM removed** — uses official `@midnight-ntwrk/ledger-v8` exclusively
- **Docs** — integration guide section 15 (GSD Connect), per-method timeouts, TX diagnostics

## 0.8.0

- **GSD Connect** — WebSocket socket allowing Node.js apps to interact with the wallet
- **gsd-wallet-connect package** — `packages/gsd-socket` with server, client, provider adapters, tracer
- **Contract deploy integration** — counter contract deploy + increment via socket (integration test)
- **Socket UI** — toggle in header, config in Settings, connect category in diagnostics
- **Per-method timeouts** — 5 min for proving/balancing, 30s for queries
- **Explorer txHash fix** — `submitTransaction` now returns the tx hash
- **Socket state persistence** — reconnect backoff, session restore across popup reopens

## 0.7.0

- **Localnet compose** — `npm run localnet:up` for node + indexer + proof server
- **BYPASS diagnostics** — warn-level events for all auto-approved operations
- **Bug fixes** — WebSocket lifecycle, checkpoint reliability
- **dist.zip** — pre-built extension with custom ledger WASM

## 0.6.1

- **Bulk WASM replay** — `replayEventsFromRaw` for 1000-event batches
- **Per-type sync diagnostics** — cache/live source, events/second, ETA per subsystem

## 0.6.0

- **Bundled mainnet cache** — 88k pre-built events for zero-download first sync
- **Parallel sync** — shielded, unshielded, dust sync independently
- **Cache export** — download event cache as NDJSON

## 0.5.0

- **Shared network event cache** — IndexedDB cache shared across wallets on the same network

## 0.4.1

- **Security fixes** — seed handling improvements
- **UI polish** — README screenshot, layout refinements

## 0.4.0

- **Major dependency upgrades** — React 19, Tailwind 4, Vite 8, TypeScript 6
- **Wallet menu** — unified dropdown with wallets grouped by network

## 0.3.1

- **Non-blocking Web Worker** — SDK host moved to Web Worker for responsive UI

## 0.3.0

- **Offscreen document architecture** — SDK moved from service worker to offscreen document

## 0.2.0

- **SDK-aligned seed derivation** — HD key derivation matching official wallet-sdk
- **UI layout improvements** — settings, diagnostics panel

## 0.1.0

- Initial release — multi-environment Chrome extension wallet for Midnight
