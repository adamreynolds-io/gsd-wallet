# Midnight Wallet SDK Reference

Snapshot from `@midnight-ntwrk/wallet-sdk`, taken 2026-04-12 from the [midnight-wallet](https://github.com/midnightntwrk/midnight-wallet) repository (main branch).

| Package | Version |
|---------|---------|
| facade | 3.0.0 |
| shielded-wallet | 2.1.0 |
| unshielded-wallet | 2.1.0 |
| dust-wallet | 3.0.0 |
| hd | 3.0.1 |
| address-format | 3.1.0 |
| capabilities | 3.2.0 |
| indexer-client | 1.2.0 |
| node-client | 1.1.0 |
| prover-client | 1.2.0 |

## Architecture & Design

- [Design](./design.md) -- Three-wallet model, facade pattern, variant/runtime structure, services and capabilities
- [Component Diagram](./wallet-component-diagram.svg) -- Visual architecture overview

## Package APIs

- [facade](./packages/facade.md) -- Unified API combining shielded, unshielded, and dust wallets
- [shielded-wallet](./packages/shielded-wallet.md) -- ZK private token operations
- [unshielded-wallet](./packages/unshielded-wallet.md) -- Transparent token operations
- [dust-wallet](./packages/dust-wallet.md) -- DUST resource management and generation
- [hd](./packages/hd.md) -- BIP-32/BIP-44 hierarchical deterministic key derivation
- [address-format](./packages/address-format.md) -- Bech32m address encoding/decoding
- [capabilities](./packages/capabilities.md) -- Transaction balancing, coin selection, imbalance tracking
- [node-client](./packages/node-client.md) -- Polkadot.js RPC client for the Midnight node
- [prover-client](./packages/prover-client.md) -- ZK proof generation service client
- [indexer-client](./packages/indexer-client.md) -- GraphQL client for the Midnight indexer

## Code Examples

Runnable snippets from the `docs-snippets` package:

- [utils.ts](./examples/utils.ts) -- Shared wallet initialization helper
- [initialization.ts](./examples/initialization.ts) -- Full wallet init, sync, and state inspection
- [hd.no-net.ts](./examples/hd.no-net.ts) -- HD key derivation (no network required)
- [addresses.no-net.ts](./examples/addresses.no-net.ts) -- Bech32m address encoding/decoding (no network required)
- [shielded-transfer.ts](./examples/shielded-transfer.ts) -- Shielded token transfer
- [unshielded-transfer.ts](./examples/unshielded-transfer.ts) -- Unshielded (NIGHT) token transfer
- [combined-transfer.ts](./examples/combined-transfer.ts) -- Combined shielded + unshielded transfer
- [balancing.ts](./examples/balancing.ts) -- Transaction balancing with manual blueprint
- [swap.ts](./examples/swap.ts) -- Shielded token swap between two wallets
- [designation.ts](./examples/designation.ts) -- Register NIGHT UTXOs for DUST generation
- [deregistration.ts](./examples/deregistration.ts) -- Deregister NIGHT UTXOs from DUST generation
- [redesignation.ts](./examples/redesignation.ts) -- Designate DUST to a different receiver
- [dust-sponsorship.ts](./examples/dust-sponsorship.ts) -- Third-party fee sponsorship flow
- [wasm-prover.ts](./examples/wasm-prover.ts) -- Initialization with WASM prover (no proof server)
- [terms-and-conditions.ts](./examples/terms-and-conditions.ts) -- Fetch and verify terms and conditions
