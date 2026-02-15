# System Implementation Plan (Step-by-Step)

Status legend: `[x] Done`

## 1) Confirm scope and acceptance criteria — [x] Done
- Confirm constraints from `CANDIDATE_INSTRUCTIONS.md` (do not modify `candidate-pack/**`, baseline tests, or workflow files).
- Lock in required outcomes:
  - green checks for `pnpm test` and `pnpm test:contracts`;
  - correct state machine behavior;
  - worker idempotency;
  - updated `DESIGN.md`.

## 2) Prepare and verify local environment — [x] Done
- Install dependencies and run tests before making changes.
- Run contract and integration tests separately to establish a baseline.

## 3) Implement the contract layer (`contracts/SettlementVault.sol`) — [x] Done
- Implement `ADMIN` and `OPERATOR` roles.
- Add `pause`/`unpause` and block payouts while paused.
- Implement `payout(to, amount, requestId)` with replay protection (`requestId` executable only once).
- Implement ERC20 transfer from vault to recipient.
- Emit `PayoutExecuted(requestId, operator, to, amount)`.

## 4) Close contract validation — [x] Done
- Run `pnpm test:contracts`.
- Fix only defects that affect assignment requirements.
- Ensure replay protection and role behavior are covered by baseline tests.

## 5) Implement the GraphQL API (`src/api/**`) — [x] Done
- `createPayoutRequest(to, amount, asset)` → create row with `PENDING_RISK`.
- `approvePayoutRequest(id)` → allow transition only to `APPROVED` when valid.
- `payoutRequest(id)` → fetch single request.
- `payoutRequests(status, first, after)` → cursor-based pagination.
- Add input validation and deterministic transition error handling.

## 6) Enforce strict status transitions in repository layer (`src/db/**`) — [x] Done
- Centralize state machine rules:
  - `PENDING_RISK -> APPROVED | REJECTED`
  - `APPROVED -> SUBMITTED | REJECTED`
  - `SUBMITTED -> CONFIRMED | FAILED`
- Block any other transitions at repository/SQL update level.

## 7) Implement worker orchestration (`src/worker/workerTick.ts`) — [x] Done
- Atomically claim exactly one `APPROVED` request per tick via lease lock (`lock_owner`, `lock_expires_at`).
- Execute risk checks from `candidate-pack/risk.json`:
  - `maxPerRequest`, `maxDailyTotal` (UTC day), `denylist`, `confirmations`.
- On risk failure, move to `REJECTED` with `risk_reason`.
- If risk passes:
  - when `tx_hash = null`, submit tx and persist `SUBMITTED`, `tx_hash`, `submitted_at`;
  - when `tx_hash` exists, do not resubmit.

## 8) Implement confirmation and failure handling — [x] Done
- For `SUBMITTED`, track receipt and confirmation count.
- Move to `CONFIRMED` with `confirmed_at` once confirmation threshold is reached.
- If tx is mined but reverted, move to `FAILED` with `failed_reason`.

## 9) Guarantee idempotency and crash safety — [x] Done
- Ensure safe resume after restart post-submit (`tx_hash` exists, final status not set).
- Prevent double payout on repeated/concurrent `workerTick()` calls.
- Verify retries do not trigger a second on-chain submission.

## 10) Add extra tests in allowed directories (if needed) — [x] Done
- Added API/worker edge-case tests under `tests/additional/**`.
- Added contract edge-case tests under `contracts/test/additional/**`.
- Covered restart, repeated tick, invalid transitions, and failure-path scenarios.

## 11) Prepare engineering documentation (`DESIGN.md`) — [x] Done
- Documented system invariants.
- Documented worst edge case and mitigation.
- Documented improvements possible with +1 day.
- Documented idempotency strategy, locking strategy, threat model, and explicit tradeoffs.

## 12) Final verification and submission readiness — [x] Done
- Ran full checks: `pnpm test`, `pnpm test:contracts`.
- Verified no modifications in forbidden paths (`.github/workflows/**`, `candidate-pack/**`).
- Deliverables and scripts are aligned with `pnpm` workflow.

---

## Recommended execution order (risk-minimizing)
1. Contract → 2. API + state transitions → 3. Worker claim/risk/submit → 4. Confirm/fail → 5. Additional tests → 6. DESIGN → 7. Final test pass.

## Definition of Done
- All required status transitions are implemented and protected against invalid updates.
- Worker is idempotent across restarts and concurrent execution.
- Contract prevents replay by `requestId` and enforces role/paused constraints.
- CI checks are green and `DESIGN.md` is completed per requirements.
