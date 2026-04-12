# Midnight Wallet Integration Guide

> Traps and non-obvious failure modes discovered building the [GSD Wallet](https://github.com/adamreynolds-io/gsd-wallet) Chrome extension. For architecture and conventions, see `CLAUDE.md`. For SDK API reference, see the [midnight-wallet](https://github.com/midnightntwrk/midnight-wallet) repo.

## SDK Traps

| Trap | What happens | Fix |
|------|-------------|-----|
| Using `mnemonicToSeedSync` instead of `mnemonicToEntropy` | Derives completely different keys from the same mnemonic | SDK uses raw 32-byte entropy, not PBKDF2 64-byte seed |
| Not checking `.type` on `HDWallet.fromSeed()` / `deriveKeyAt()` | Continues with undefined keys, fails deep in facade | Always check tagged union: `'seedOk'`, `'keyDerived'` |
| Not calling `facade.start()` after `init()` | Wallet never syncs, no state updates, no errors | `init()` creates; `start()` connects |
| Awaiting `facade.start()` before subscribing to state | UI blocks for entire sync duration | Subscribe first, start without awaiting |
| Accessing `dust.balance` as a property | Throws | It's a method: `dust.balance(new Date())` |
| Passing BigInt through `postMessage` / `JSON.stringify` | Throws | Convert to string at every IPC boundary |
| Using `utxo.intentHash` as indexer lookup | "Not found" | Intent hash is not a transaction hash |
| Not wrapping address encoding in try-catch | Throws when address not yet synced | `MidnightBech32m.encode()` and `DustAddress.encodePublicKey()` throw |
| Averaging per-subsystem sync percentages | Inflated result (unshielded at 100% dominates) | Sum `applied` / `highest` across all subsystems |
| `highestRelevantWalletIndex === 0` | Looks synced but isn't | Means indexer hasn't determined it yet; check `isConnected` |
| Missing `assert` polyfill in Worker | `DustAddress` encoding fails | Hidden dep via `@subsquid/scale-codec` in `address-format` |
| Missing `wasm-unsafe-eval` in manifest CSP | WASM fails to load, no error message | Required for `@midnight-ntwrk/ledger-v8` |

## Chrome MV3 Constraints

| Constraint | Impact | Mitigation |
|-----------|--------|------------|
| SW killed after ~30s idle | SDK WebSockets don't count as activity | Run SDK in offscreen document + Web Worker |
| No `chrome.storage` in offscreen | Can't cache state or persist diagnostics from Worker | SW receives broadcasts over port, handles persistence |
| `port.postMessage` silently fails | Popup misses state updates after reconnection | Dual-channel: port + `chrome.storage.onChanged` fallback |
| Popup height capped at ~600px | UI clipped | Offer "Open in Full Tab" |
| Disclaimer gate bypassed | DApps call API before user accepts terms | Check disclaimer in SW DApp handler, not just popup |

## Upstream SDK Bugs

Two issues in `@midnight-ntwrk/wallet-sdk-dust-wallet` not addressable from the wallet side:

1. **Segment ID collision** — Dust balancer creates fee intents on the same segment ID as the contract call intent. Causes `IntentSegmentIdCollision` for every contract call TX (not deploys). Detected after ~38s of computation.

2. **Event loop blocking** — `balanceTransactions()` runs ~38s synchronously. `setTimeout`/`Promise.race` can't interrupt it (same event loop). Even in a Web Worker, heartbeats and timeouts are blocked.

Evidence: [gsd-wallet#10](https://github.com/adamreynolds-io/gsd-wallet/issues/10), [issue-734-validation](https://github.com/adamreynolds-io/issue-734-validation) (7 tests).

## Token Model (not in SDK docs)

Contract-minted token IDs: `SHA256(ContractAddress || DomainSeparator)`. The wallet discovers these automatically from UTXO `type` fields. `NIGHT_TOKEN_ID` is 64 zeros. All tokens share the same balance map — "NIGHT = 0 with other tokens visible" is correct behavior.
