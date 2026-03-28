# Known Issues

## Segment ID Collision in Transaction Balancing

**Status:** Unresolved — SDK-level issue, workaround in place

**Symptom:** `balanceUnsealedTransaction` fails with `IntentSegmentIdCollision` when the balancing transaction's randomly-chosen segment ID collides with the base transaction's existing segment IDs.

**Root cause:** The ledger's `Transaction.fromPartsRandomized()` picks a random `u16` segment ID from `2..65535` with **zero awareness** of which segment IDs the base transaction already uses. When the facade calls `.merge()`, the ledger rejects the merge if any segment ID is duplicated.

**Affected code:**
- `midnight-ledger/ledger/src/structure.rs:1401-1407` — the merge validation
- `midnight-wallet/packages/dust-wallet/src/v1/Transacting.ts:524` — where `fromPartsRandomized` is called
- `midnight-wallet/packages/facade/src/index.ts:351,378,451,458` — merge call sites with no pre-validation

**SDK status:** No retry logic, no collision avoidance, no segment ID specification API exists anywhere in the wallet SDK (v3.0.0). This is completely undocumented.

**GSD wallet workaround:** `src/background/connectedApiHandler.ts:191-212`
- Retries `balanceUnboundTransaction` up to 3 times on collision
- Falls back to returning the base transaction without fee balancing if merge still collides (line 238) — **this is risky as the transaction may be rejected by the network**

**Proper fix (requires SDK change):**
- `Transaction.fromPartsRandomized()` should accept an `excludedSegmentIds: Set<u16>` parameter
- The facade's balance methods should extract segment IDs from the base transaction and pass them to the dust wallet
- Alternatively, the facade should retry internally with a new random seed on collision

**Tracked:** This should be raised as an issue against `midnight-wallet` or `midnight-ledger`.
