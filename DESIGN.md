# Design Document — Settlement Orchestrator

## 1. Invariants

1. **No double-pay:** Every `requestId` can trigger at most one on-chain payout. This is enforced both on-chain (`requestExecuted[requestId]` mapping checked+set before transfer) and off-chain (the worker only submits when `tx_hash IS NULL` and the contract's replay guard is the final safety net).

2. **Monotonic state machine:** Payout requests follow a strict directed transition graph: `PENDING_RISK → APPROVED | REJECTED`, `APPROVED → SUBMITTED | REJECTED`, `SUBMITTED → CONFIRMED | FAILED`. The worker never moves a request backward.

3. **Lease-based mutual exclusion:** At most one worker instance processes a given request at a time. The `lock_owner` + `lock_expires_at` columns implement an optimistic lease, claims are atomic (single UPDATE with a WHERE guard), and expired leases are automatically reclaimable.

4. **Risk limits are hard caps:** `maxPerRequest`, `maxDailyTotal`, and the `denylist` are enforced before any on-chain interaction.

## 2. Worst Edge Case

**Crash between tx submission and status persistence.** If the worker submits a payout on-chain, receives the `txHash`, but crashes before writing `SUBMITTED` + `tx_hash` to the database, the request remains `APPROVED` with `tx_hash = NULL`. On restart the worker will re-claim it and attempt to submit again.

A further improvement would be to derive `requestId` deterministically from the payout request ID so that even if the off-chain DB is lost, the contract state is the authoritative record of which payouts executed.

