# Midnight Wallet SDK Reference

The authoritative source for the Midnight Wallet SDK is the [midnight-wallet](https://github.com/midnightntwrk/midnight-wallet) repository. Do not maintain local copies of SDK docs — they drift.

## Package READMEs

Each package's README is the canonical API reference:

| Package | README |
|---------|--------|
| facade | [packages/facade](https://github.com/midnightntwrk/midnight-wallet/tree/main/packages/facade) |
| shielded-wallet | [packages/shielded-wallet](https://github.com/midnightntwrk/midnight-wallet/tree/main/packages/shielded-wallet) |
| unshielded-wallet | [packages/unshielded-wallet](https://github.com/midnightntwrk/midnight-wallet/tree/main/packages/unshielded-wallet) |
| dust-wallet | [packages/dust-wallet](https://github.com/midnightntwrk/midnight-wallet/tree/main/packages/dust-wallet) |
| hd | [packages/hd](https://github.com/midnightntwrk/midnight-wallet/tree/main/packages/hd) |
| address-format | [packages/address-format](https://github.com/midnightntwrk/midnight-wallet/tree/main/packages/address-format) |
| capabilities | [packages/capabilities](https://github.com/midnightntwrk/midnight-wallet/tree/main/packages/capabilities) |
| node-client | [packages/node-client](https://github.com/midnightntwrk/midnight-wallet/tree/main/packages/node-client) |
| prover-client | [packages/prover-client](https://github.com/midnightntwrk/midnight-wallet/tree/main/packages/prover-client) |
| indexer-client | [packages/indexer-client](https://github.com/midnightntwrk/midnight-wallet/tree/main/packages/indexer-client) |

## Code examples

Runnable snippets: [packages/docs-snippets/src/snippets/](https://github.com/midnightntwrk/midnight-wallet/tree/main/packages/docs-snippets/src/snippets)

## Architecture

- [Design doc](https://github.com/midnightntwrk/midnight-wallet/blob/main/docs/Design.md)
- [Component diagram](https://github.com/midnightntwrk/midnight-wallet/blob/main/docs/wallet-component-diagram.svg)

## Versions used by GSD Wallet

See `package.json` for exact pinned versions. As of v1.0.0:

| Package | Version |
|---------|---------|
| `@midnight-ntwrk/wallet-sdk-facade` | 3.0.0 |
| `@midnight-ntwrk/wallet-sdk-hd` | 3.0.1 |
| `@midnight-ntwrk/ledger-v8` | 8.0.3 |
| `@midnight-ntwrk/dapp-connector-api` | 4.0.1 |
