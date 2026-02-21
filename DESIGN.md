# DESIGN

## 1. Invariants

- **One payout per requestId on-chain:** The contract stores `requestExecuted[requestId] = true` before transfer; a second call with the same `requestId` reverts with `"already-executed"`.
- **Status machine:** Only allowed transitions are enforced (PENDING_RISK → APPROVED|REJECTED, APPROVED → SUBMITTED|REJECTED, SUBMITTED → CONFIRMED|FAILED). The worker and API never set invalid transitions.
- **Single owner of a claim per tick:** `claimOneApproved` runs inside a DB transaction (BEGIN/COMMIT). Only one row is selected and updated; no other worker can claim the same row in the same window.
- **No double submission:** The worker submits only when `tx_hash` is null; after submission it stores `tx_hash` and never submits again for that request.

## 2. Worst edge case

**Double payout after restart with same requestId:** The most dangerous case is a worker crash after sending the transaction but before persisting `tx_hash`. On restart, another tick could treat the request as “no tx_hash” and submit again. Mitigation: we persist `tx_hash` and status SUBMITTED in the same `updateStatus` call immediately after `submitPayout` returns. So the only window is between the chain call and the DB write. If we crash there, we might resubmit. To fully harden, one would submit via a sidecar that stores the pending tx before broadcasting, or use a single-writer process so only one worker can submit.

Additional mitigation: the contract’s replay protection guarantees that even if two transactions are sent, only the first to be mined succeeds; the second reverts with `"already-executed"`. So we never double-pay on-chain; at worst we waste gas on a reverted tx.

## 3. Next improvements (1 more day)

- **Observability:** Add structured logs and metrics (e.g. claimed id, action, risk reject reason, tx hash). This would make debugging and alerting in CI/hidden tests much easier.
- **Retries and RPC resilience:** Wrap `submitPayout` and `getReceipt` in retries with backoff for transient RPC failures; distinguish “tx not mined yet” from “RPC error” so we don’t mark requests as FAILED on network blips.
- **Contract audit:** Have the vault and replay logic reviewed; consider SafeERC20 and reentrancy guard if the token is not trusted.

---

## Idempotency strategy

- **Per request:** One logical payout request is identified by DB `id` and on-chain by `requestId` (bytes32). We submit at most once: we only call `chain.submitPayout` when `tx_hash` is null; after that we only do confirmation tracking.
- **Restarts:** If the worker restarts with a request in SUBMITTED, we do not resubmit; we only call `getReceipt` and move to CONFIRMED or FAILED based on confirmations and revert status.
- **Concurrent ticks:** Lease-based locking ensures only one worker owns a given APPROVED row for the lease window; we claim one row per tick inside a transaction, so concurrent ticks get different rows or the same tick sees “none” after the first claim.

## Locking strategy

- **Lease lock:** For each tick we call `claimOneApproved(now, workerId, leaseMs)`. We select one row with `status = APPROVED` and `(lock_expires_at IS NULL OR lock_expires_at < now)`, then in the same transaction set `lock_owner = workerId` and `lock_expires_at = now + leaseMs`. So one request is claimed per tick; after the lease expires, another worker can claim it if it wasn’t yet moved to SUBMITTED/CONFIRMED/FAILED.
- **Atomicity:** The select and update run inside a single SQLite transaction (BEGIN … COMMIT), so no interleaving with another process for that claim.

## Threat model

- **On-chain:** (1) Replay: mitigated by `requestExecuted` and single execution per requestId. (2) Unauthorized payout: only OPERATOR role can call `payout`; ADMIN manages operators. (3) Paused vault: `whenNotPaused` blocks payouts until unpause.
- **Off-chain:** (1) Double claim: mitigated by transactional `claimOneApproved` and lease. (2) Double submit: we only submit when `tx_hash` is null and set it in the same update. (3) Status desync: we use a single DB and a clear state machine; no out-of-band status changes. (4) Risk bypass: worker runs `runRiskChecks` (maxPerRequest, maxDailyTotal, denylist) before submit and rejects with `risk_reason` when checks fail.

## Definition of “today” for maxDailyTotal

**“Today” is the UTC calendar date** derived from the worker’s current time. We compute it as `new Date(now * 1000).toISOString().slice(0, 10)` (YYYY-MM-DD in UTC). The daily total is the sum of `amount` over all rows with `status IN ('CONFIRMED','SUBMITTED')` and `date(submitted_at, 'unixepoch') = that UTC date` (i.e. the submission happened on that UTC day).
