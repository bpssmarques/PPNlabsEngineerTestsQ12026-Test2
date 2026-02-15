# Architecture — Settlement Orchestrator

This document reflects the **current implementation (monolith)** and its immediate hardening path.

Derived from:
- `docs/userflows.md`
- `CANDIDATE_INSTRUCTIONS.md`

## 1. Current Architecture (Monolith)

The current solution is a single deployable application with internal modules:
- API layer (GraphQL commands/queries)
- DB/repository layer
- Worker orchestration logic
- Chain client integration
- Risk evaluation logic

All modules share one codebase and one primary data model.

### 1.1 Current Modules and Methods

#### API Module
**Responsibilities**
- Accept payout commands and expose read endpoints.

**Methods**
- `createPayoutRequest(to, amount, asset)`
- `approvePayoutRequest(id)`
- `payoutRequest(id)`
- `payoutRequests(status, first, after)`

#### Worker Module
**Responsibilities**
- Claim approved work with lease lock.
- Run risk checks.
- Submit payouts and track confirmations.

**Methods**
- `workerTick(context)`
- `claimApproved(now, workerId, leaseMs)`
- `runRiskChecks(row, dailyTotal)`
- `submitPayout(requestId, to, amount)`
- `getReceipt(txHash)`

#### Contract Module
**Responsibilities**
- Enforce access control, pause safety, replay protection.

**Methods**
- `setOperator(address, enabled)`
- `pause()`
- `unpause()`
- `payout(to, amount, requestId)`

## 2. Shared Domain Model

### 2.1 Primary Entity: `PayoutRequest`
- `id`
- `requestId`
- `to`
- `asset`
- `amount`
- `status`
- `riskReason`
- `txHash`
- `submittedAt`
- `confirmedAt`
- `failedReason`
- `lockOwner`
- `lockExpiresAt`

### 2.2 State Model
Allowed transitions only:
- `PENDING_RISK -> APPROVED | REJECTED`
- `APPROVED -> SUBMITTED | REJECTED`
- `SUBMITTED -> CONFIRMED | FAILED`

Any transition outside this graph is invalid.

## 3. Current Runtime Flow (Monolith)

1. API creates request (`PENDING_RISK`).
2. API approves request (`APPROVED`).
3. Worker atomically claims one approved request (lease lock).
4. Risk module evaluates policy.
   - Fail -> `REJECTED`.
   - Pass -> continue.
5. If no `txHash`, chain module submits transaction and stores `txHash` + `submittedAt`.
6. Worker tracks receipt/confirmations and finalizes to `CONFIRMED` or `FAILED`.
7. API query endpoints return current state/history.

## 4. Reliability Invariants (Current)

1. One business request must not cause double payment.
2. Existing `txHash` must not trigger re-submission.
3. Final states are terminal (`CONFIRMED`, `FAILED`, `REJECTED`).
4. Risk policy is evaluated before initial on-chain submission.
5. State transitions must stay inside the allowed state graph.

## 5. Business and Operational Requirements (Current)

### 5.1 API Requirements
- GraphQL server must be consistently bootable and able to process command/query operations in-process.
- Request creation command must accept `to`, `amount`, `asset` and persist a new record in `PENDING_RISK` state.
- Request approval command must transition valid records from `PENDING_RISK` to `APPROVED` only.
- API responses for successful command handling must be deterministic and free of execution errors.

### 5.2 Worker Runtime Requirements
- Worker must process approved work using lease-based claim semantics and claim at most one row per tick.
- Worker processing pipeline must preserve order: `claim -> risk -> submit/track -> finalize`.
- When processing an approved request with no `txHash`, worker must submit once and transition to `SUBMITTED` with persisted `txHash` and `submittedAt`.
- Repository and worker interaction must support lifecycle progression from creation through approval to submission without invalid transitions.

### 5.3 Baseline Acceptance Scope
- Baseline acceptance requires stable API command execution for request creation/approval and stable worker submission flow.
- Advanced scenarios (reorg handling, richer failure taxonomy, stronger idempotency fencing under contention) are handled in the hardening plan below.

## 6. Current Risks and Gaps (Monolith)

1. **Lease lock without fencing token** can allow stale workers to continue writing after lease expiry.
2. **Finality model is underspecified** (`N confirmations` alone may be insufficient under chain reorg conditions).
3. **Nonce handling is implicit** and can become fragile under parallel transaction submission.
4. **Risk policy is static** and lacks policy versioning + decision explainability for auditability.
5. **Signer boundary is not isolated** (critical for production custody and key management).
6. **Observability is not audit-grade by default** for full money-flow reconstruction.

## 7. Monolith Hardening Plan (No Service Split)

1. Add **fencing tokens** to lease claim/update path (`lock_version`) and enforce compare-and-set writes.
2. Introduce explicit **transaction lifecycle states**: `submitted`, `seen`, `safe`, `finalized`, `failed/replaced`.
3. Add **reorg-aware confirmation policy** (safe/finalized semantics per chain, not only generic confirmations).
4. Implement **nonce allocation strategy** per signer/account to prevent tx replacement races.
5. Introduce **policy versioning** for risk checks and persist `(policyVersion, inputs, decisionReason)`.
6. Separate **signing responsibility** from general app runtime (at minimum isolated signing module + strict ACL).
7. Add structured **audit tracing** for `requestId -> txHash -> receipt -> status transitions`.
8. Add **circuit-breakers/limits** by asset/network/day to cap blast radius during incidents.

## 8. Future Improvements

Forward-looking improvements (microservice split and horizontal scaling roadmap) are documented in `docs/improvements.md`.

## 9. Notes

Current delivery remains a monolith for implementation simplicity and CI fit.
