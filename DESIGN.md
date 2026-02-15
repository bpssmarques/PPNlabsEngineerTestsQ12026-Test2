# DESIGN

## 1) System overview

This project implements a minimal payout orchestrator with three boundaries:

- **Smart contract (`SettlementVault`)**: custody and constrained execution of ERC20 payouts.
- **GraphQL API**: request creation/approval and query interface.
- **Worker (`workerTick`)**: risk checks, transaction submission, and confirmation tracking.

The workflow is:

1. API creates a payout request in `PENDING_RISK`.
2. API approves request to `APPROVED`.
3. Worker claims one eligible row, runs risk checks, submits tx (or tracks existing tx), and transitions status.
4. Contract enforces final on-chain constraints and replay protection.

## 2) Invariants (critical guarantees)

The implementation is designed to preserve these invariants:

1. **No illegal state transitions**
	- Allowed transitions are strictly enforced in repository logic:
	  - `PENDING_RISK -> APPROVED | REJECTED`
	  - `APPROVED -> SUBMITTED | REJECTED`
	  - `SUBMITTED -> CONFIRMED | FAILED`
	- Any direct or out-of-order transition is rejected.

2. **At-most-once on-chain execution per business request**
	- `SettlementVault` tracks `requestExecuted[requestId]`.
	- A repeated payout for the same `requestId` always reverts.

3. **Payout safety gate**
	- Payouts are blocked while paused.
	- Recipient zero address and zero amount are rejected.
	- Optional on-chain controls (`maxPerPayout`, `dailyLimit`, denylist) are enforced.

4. **Signature-bound approvals when risk signer is enabled**
	- If `riskSigner` is configured, direct `payout()` is blocked.
	- `payoutWithApproval()` requires a valid EIP-712 signature over `(requestId, to, amount)`.

5. **Single-row processing per worker tick**
	- Worker claims exactly one row (`APPROVED` first, else `SUBMITTED`) and releases lock in `finally`.

6. **Idempotent resumption after crash/restart**
	- If `tx_hash` exists, worker does not resubmit and switches to receipt tracking.
	- This prevents duplicate submissions from normal restart flows.

## 3) Idempotency strategy

Idempotency is implemented at two layers:

- **Off-chain (DB + worker)**
  - Worker stores `tx_hash` when transitioning to `SUBMITTED`.
  - On future ticks, existing `tx_hash` means “track receipt only”, not “submit again”.
  - Transition guards in repo prevent status corruption.

- **On-chain (contract replay guard)**
  - Even if an off-chain duplicate submit attempt occurs, `requestId` replay protection rejects it.

Together, these provide practical idempotency under retries, process restarts, and temporary RPC failures.

## 4) Locking strategy

Locking is lease-based and transactional in SQLite repository methods:

- Claim is executed in `BEGIN IMMEDIATE TRANSACTION`.
- A row is claimable only if `lock_expires_at` is null or `< now`.
- Claim writes `lock_owner` and `lock_expires_at = now + leaseMs` atomically.
- At tick completion, lock is released in `finally`, ensuring unlock even on errors.

This approach avoids concurrent workers processing the same row in the same window, while allowing recovery if a worker crashes (lease expiry).

### SQLite lock contention tradeoff (implemented)

For `SQLITE_BUSY` during claim acquisition, the repository uses a **fail-fast** strategy:

- A claim attempt returns `null` immediately when the database is busy.
- Retry is deferred to the next worker tick (instead of blocking inside the same tick).

Why this choice:

- It avoids CPU-bound busy-wait loops in synchronous code.
- It keeps tick latency predictable under contention.
- It reduces complexity in the claim path.

Tradeoff:

- Under heavy contention, some ticks do no useful work.
- End-to-end processing latency can increase because progress depends on tick frequency.

If lower latency under contention is required, the next step is to move claim retries to async backoff (non-blocking timer-based delay) or tune SQLite lock timeout behavior.

## 5) Risk checks and UTC day definition

Risk checks use `candidate-pack/risk.json`:

- `maxPerRequest`
- `maxDailyTotal`
- `denylist`
- `confirmations`

For daily limits, **"today" is defined in UTC**:

- Day start: `00:00:00 UTC`
- Day end (exclusive): next `00:00:00 UTC`

The worker computes UTC day bounds and uses repository aggregation for that interval. Daily check uses `dailyTotal + amount > maxDailyTotal` to include the candidate payout in the decision.

## 6) Threat model and mitigations

### On-chain risks

1. **Duplicate payout execution**
	- Mitigation: `requestExecuted[requestId]` replay guard.

2. **Privilege abuse by non-operators**
	- Mitigation: role-based access control (`OPERATOR_ROLE`, `ADMIN_ROLE`), hardened role admin hierarchy.

3. **Bypassing off-chain risk checks**
	- Mitigation: optional EIP-712 risk signer gate + on-chain payout constraints.

4. **Emergency/incident response**
	- Mitigation: pause/unpause, request cancellation, denylist, emergency withdrawal path.

### Off-chain risks

1. **Worker race/concurrency**
	- Mitigation: transactional lease lock + one-row claim per tick.

2. **Crash after submission / before confirmation**
	- Mitigation: persisted `tx_hash` and resume-from-submitted flow.

3. **RPC instability / transient exceptions**
	- Mitigation: retry-by-next-tick design and deterministic status transitions.

4. **Risk engine or signer key compromise**
	- Mitigation: signer rotation via admin (`setRiskSigner`), operational key controls (recommended: KMS/HSM).

## 7) Worst edge case

**Most dangerous edge case:** worker submits a payout transaction, then crashes before durable off-chain state reflects that submission, causing potential replay attempts after restart.

**How it is handled:**

- Primary protection is on-chain replay prevention by `requestId`, which prevents second successful payout for the same business request.
- Worker design persists `tx_hash` during the `APPROVED -> SUBMITTED` transition and uses it to avoid resubmission in normal restart cases.
- If persistence race or crash still causes ambiguity, the contract remains the final safety boundary.

## 8) Next improvements (if I had one more day)

1. **Signature anti-replay hardening**
	- Add `deadline` and explicit signer nonce to signed payload.
	- Rationale: bounded signature lifetime and stronger replay controls.

2. **Operational key hardening**
	- Move admin/risk signing to multisig + KMS/HSM-backed keys.
	- Rationale: lower key-compromise blast radius.

3. **Observability and audit trail**
	- Add structured audit events/metrics for every status transition, lock claim, and on-chain call outcome.
	- Rationale: faster incident triage and forensic traceability.

4. **Incident controls refinement**
	- Add timelock (or dual-control) for `emergencyWithdraw` and signer changes.
	- Rationale: reduce single-actor abuse risk.

5. **More adversarial tests**
	- Add chaos tests for lease expiry, partial DB failures, and concurrent worker bursts.
	- Rationale: validate behavior under production-like failure modes.

## 9) Additional architecture tradeoffs

To align this design with the architecture and improvements documents, these tradeoffs are explicitly acknowledged:

1. **Monolith vs microservices**
	- Current choice: monolith for delivery speed and lower operational overhead.
	- Tradeoff: weaker fault isolation and independent scaling compared to service split.

2. **DB lease polling vs partitioned queue**
	- Current choice: DB lease polling for minimal infrastructure and simpler operations.
	- Tradeoff: queue partitioning can scale better at high throughput, but introduces more distributed-systems complexity.

3. **Generic confirmations vs chain finality semantics**
	- Current choice: confirmation-count based finalization for simplicity.
	- Tradeoff: lower implementation complexity and potentially lower latency, but weaker resilience to deep reorgs than `safe/finalized` chain-specific policies.

4. **Local nonce handling vs centralized nonce manager**
	- Current choice: local nonce flow in a single-process context.
	- Tradeoff: simple and lightweight today, but more race-prone under parallelized multi-worker transaction submission.
