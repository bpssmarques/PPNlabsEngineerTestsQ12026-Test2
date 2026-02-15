# Improvements Roadmap — Settlement Orchestrator

This document captures the **future evolution path** for the current monolith toward microservices and horizontal scaling.

## 1. Target Architecture — Microservice Split

### 1.1 `payout-command-service`
**Methods**
- `createPayoutRequest(to, amount, asset)`
- `approvePayoutRequest(id)`
- `rejectPayoutRequest(id, reason)`

### 1.2 `payout-query-service`
**Methods**
- `getPayoutRequest(id)`
- `listPayoutRequests(status, first, after)`

### 1.3 `risk-policy-service`
**Methods**
- `evaluate(request)`
- `getRequiredConfirmations(asset)`
- `getDailyExposure(utcDate, asset)`

### 1.4 `orchestrator-service`
**Methods**
- `claimApproved(now, workerId, leaseMs)`
- `processTick()`
- `resumeSubmitted()`
- `markConfirmed(requestId, confirmedAt)`
- `markFailed(requestId, reason)`

### 1.5 `chain-executor-service`
**Methods**
- `submitPayout(requestId, to, amount)`
- `getReceipt(txHash)`
- `isReverted(txHash)`

### 1.6 `confirmation-tracker-service`
**Methods**
- `track(txHash, requiredConfirmations)`
- `updateConfirmationStatus()`

### 1.7 `vault-admin-service`
**Methods**
- `setOperator(address, enabled)`
- `pause()`
- `unpause()`

### 1.8 `signer-service` (recommended)
**Purpose**
- Isolate key operations from business services.

**Methods**
- `signAndSubmit(txPayload)`
- `estimateAndPrepare(txPayload)`
- `rotateSigner(signerId)`

## 2. Horizontal Scalability Strategy

### 2.1 Stateless Replicas
- Run multiple stateless instances for command/query/orchestrator services.

### 2.2 Safe Concurrent Claiming
Keep atomic claim semantics (SQL compare-and-set / transactional update):
- select only `APPROVED` rows with expired/null lease;
- update lease in one transactional statement;
- return exactly one row.

This prevents two workers from processing the same request simultaneously.

### 2.3 Idempotency at Multiple Layers
- Business idempotency key: `requestId`.
- Persistence constraints: unique `requestId`, unique `txHash` where applicable.
- On-chain replay protection in vault contract per `requestId`.

### 2.4 Work Partitioning
- Option A: DB lease + pollers (simple baseline).
- Option B: Message bus with partition key `requestId` (better large-scale throughput).

### 2.5 CQRS Split
- Isolate write path (`payout-command-service`) from read path (`payout-query-service`) to reduce contention under heavy reads.

### 2.6 Scale Hot Path Separately
- `confirmation-tracker-service` is I/O-heavy and should scale independently from command/query services.

### 2.7 Reorg-aware Finality Tracking
- Track chain-specific finality (`safe` / `finalized`) instead of relying only on generic confirmation count.

## 3. Suggested Persistence Ownership (Future)

- `payout-command-service`: source-of-truth write model for payout requests.
- `payout-query-service`: denormalized read model.
- `orchestrator-service`: lease/checkpoint metadata.
- `chain-executor-service`: tx submission attempts and receipt cache.
- `risk-policy-service`: policy version metadata and decision logs.

## 4. Suggested External Interfaces (Future)

- Public API gateway can expose GraphQL while internally routing to command/query services.
- Internal service communication can be gRPC/HTTP + async events.
- Event examples:
  - `PayoutRequestCreated`
  - `PayoutRequestApproved`
  - `RiskCheckRejected`
  - `PayoutSubmitted`
  - `PayoutConfirmed`
  - `PayoutFailed`

## 5. Security and Governance Hardening (Future)

### 5.1 Admin Governance Controls
- Move `ADMIN` operations to multisig control.
- Add timelock for sensitive actions (`setOperator`, pause/unpause policy updates).
- Keep emergency pause path with explicit break-glass procedure and audit trail.

### 5.2 API Security Baseline
- Add authentication and role-based authorization for GraphQL mutations.
- Add request throttling/rate limiting for mutation endpoints.
- Add structured audit logging for every privileged operation and state-changing request.

### 5.3 Signing Boundary
- Keep signing isolated from general API/runtime logic.
- Restrict key access through dedicated signer service/HSM policy.

## 6. Architectural Trade-offs (Future)

### 5.1 Monolith vs Microservices
- **Monolith**: faster delivery, lower operational complexity, simpler debugging.
- **Microservices**: better fault isolation and team autonomy, but higher platform and consistency complexity.

### 5.2 DB Lease Polling vs Partitioned Queue
- **DB lease**: simple baseline, minimal infra.
- **Partitioned queue**: better horizontal scaling/ownership, but requires stronger event and replay discipline.

### 5.3 Generic Confirmations vs Chain Finality
- **Generic confirmations**: lower latency but weaker reorg resilience.
- **Finality-aware policy**: safer for value transfers, with increased settlement latency.

### 5.4 Local Nonce Handling vs Centralized Nonce Manager
- **Local nonce**: simple but race-prone under parallel workers.
- **Centralized nonce service**: safer at scale, adds coordination overhead.

## 7. Phased Migration Plan

### Phase 1 — Foundation
- Keep monolith, add outbox/inbox event guarantees.
- Introduce tx lifecycle model and reorg-aware confirmation semantics.
- Add policy versioning and audit-grade traces.

### Phase 2 — Risk/Chain Isolation
- Extract `risk-policy-service`, `chain-executor-service`, and `signer-service`.
- Introduce nonce manager and signer isolation boundaries.

### Phase 3 — Full Domain Split
- Split command/query/orchestrator.
- Add read model projection and queue partitioning by `requestId`.
- Scale confirmation tracking independently.

## 8. Migration Note

The current implementation remains monolithic for delivery simplicity and CI fit. This roadmap is intended for phased extraction once throughput, team size, or operational requirements justify service boundaries.
