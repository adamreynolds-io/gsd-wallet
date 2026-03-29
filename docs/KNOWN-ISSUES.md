# Known Issues

## Segment ID Collision During DApp Transaction Balancing

**Status:** Open — requires further investigation

**Symptom:** `balanceUnsealedTransaction` (DApp connector API) can fail with `IntentSegmentIdCollision` when merging the base transaction with the balancing transaction.

**Context:** This operation works correctly in the Lace wallet and in the wallet-dapp-deploy test harness, so the issue is likely in how GSD wallet calls the SDK's balancing APIs rather than in the SDK itself.

**Current workaround:** `src/background/connectedApiHandler.ts:191-212` retries balancing up to 3 times and falls back to returning the base transaction without fee balancing. This is a temporary measure.

**Next steps:**
- Compare the GSD wallet's `balanceUnsealedTransaction` implementation against Lace's approach
- Check whether the transaction deserialization step (`Transaction.deserialize`) preserves segment IDs correctly
- Verify the correct `Transaction` type variant is being used for the balance call
- Review whether the `tokenKindsToBalance` option should be specified
