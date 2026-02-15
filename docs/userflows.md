# User Flows — Settlement Orchestrator

This document captures the key user flows based on `CANDIDATE_INSTRUCTIONS.md`.

## Actors
- **Requester** — creates payout requests through the API.
- **Approver/Admin** — approves requests for execution.
- **Worker/Operator** — background process that performs risk checks, submits transactions, and tracks confirmations.
- **Observer** — reads payout status and history.

---

## 1) Create Payout Request
**Goal:** create a new payout request in the system.

**Preconditions:** API is available.

**Steps:**
1. Requester calls `createPayoutRequest(to, amount, asset)`.
2. API validates the input.
3. A DB row is created with status `PENDING_RISK`.
4. API returns the created request (`id`, `requestId`, `status`).

**Result:** request is created and ready for the next step.

**Gherkin**
```gherkin
Feature: Create payout request

  Scenario: Request is created successfully
    Given the API is available
    When the requester calls createPayoutRequest with valid to, amount, and asset
    Then a payout request is stored with status PENDING_RISK
    And the response includes id, requestId, and status
```

---

## 2) Approve Payout Request
**Goal:** move request to worker-processing stage.

**Preconditions:** request exists and is `PENDING_RISK`.

**Steps:**
1. Approver/Admin calls `approvePayoutRequest(id)`.
2. System validates the transition.
3. Status is updated to `APPROVED`.

**Result:** request becomes available for worker claim.

**Gherkin**
```gherkin
Feature: Approve payout request

  Scenario: Pending request becomes approved
    Given a payout request exists with status PENDING_RISK
    When the approver calls approvePayoutRequest with the request id
    Then the request status becomes APPROVED
```

---

## 3) Worker Claims Exactly One Request (Lease Lock)
**Goal:** prevent double-processing in concurrent runs.

**Preconditions:** at least one request is `APPROVED`.

**Steps:**
1. `workerTick()` selects one `APPROVED` row with available lock (`lock_expires_at IS NULL OR < now`).
2. In an atomic operation, sets `lock_owner` and `lock_expires_at = now + leaseMs`.
3. Returns exactly one claimed request.

**Result:** only one worker owns the request in this tick.

**Gherkin**
```gherkin
Feature: Atomic worker claim

  Scenario: Worker claims one approved request
    Given at least one payout request is APPROVED and lock is available
    When workerTick runs
    Then exactly one request is claimed
    And lock_owner is set
    And lock_expires_at is set to now plus leaseMs
```

---

## 4) Risk Check Rejection
**Goal:** stop unsafe payouts before on-chain submission.

**Preconditions:** request is claimed by worker.

**Steps:**
1. Worker applies `candidate-pack/risk.json` rules:
   - `maxPerRequest`
   - `maxDailyTotal` (UTC day)
   - `denylist`
   - `confirmations`
2. If validation fails, status becomes `REJECTED`.
3. `risk_reason` is stored.

**Result:** risky request is blocked and never submitted on-chain.

**Gherkin**
```gherkin
Feature: Risk rejection

  Scenario: Request fails denylist check
    Given a claimed APPROVED request where recipient is denylisted
    When workerTick executes risk checks
    Then the request status becomes REJECTED
    And risk_reason is set
```

---

## 5) Successful On-Chain Submission
**Goal:** submit payout transaction when risk checks pass.

**Preconditions:** request is `APPROVED`; risk checks passed.

**Steps:**
1. If `tx_hash` is empty, worker calls `submitPayout(requestId, to, amount)`.
2. Stores `tx_hash` and `submitted_at`.
3. Updates status to `SUBMITTED`.

**Result:** transaction is sent and tracked for confirmations.

**Gherkin**
```gherkin
Feature: Submit payout transaction

  Scenario: Worker submits transaction once
    Given an APPROVED request passed risk checks
    And tx_hash is null
    When workerTick submits payout
    Then status becomes SUBMITTED
    And tx_hash is stored
    And submitted_at is stored
```

---

## 6) Idempotent Resume After Restart/Retry
**Goal:** prevent duplicate payments on retries and restarts.

**Preconditions:** request already has `tx_hash` and is `SUBMITTED` (or interrupted after submit).

**Steps:**
1. Next `workerTick()` picks the request.
2. Detects existing `tx_hash`.
3. Does **not** call `submitPayout` again.
4. Proceeds to receipt/confirmation tracking.

**Result:** no duplicate on-chain submission; business-level exactly-once behavior is preserved.

**Gherkin**
```gherkin
Feature: Idempotent processing

  Scenario: Existing tx hash prevents re-submission
    Given a request already has tx_hash and is in SUBMITTED state
    When workerTick runs after a restart
    Then submitPayout is not called again
    And worker proceeds to confirmation tracking
```

---

## 7) Transaction Confirmation
**Goal:** finalize successful payout lifecycle.

**Preconditions:** request is `SUBMITTED`; `tx_hash` exists.

**Steps:**
1. Worker fetches receipt via `getReceipt(txHash)`.
2. If `confirmations >= required`, sets status to `CONFIRMED`.
3. Stores `confirmed_at`.

**Result:** payout is finalized as successful.

**Gherkin**
```gherkin
Feature: Confirm payout transaction

  Scenario: Required confirmations reached
    Given a request is SUBMITTED with a tx_hash
    And receipt confirmations are greater than or equal to required confirmations
    When workerTick evaluates confirmation status
    Then the request status becomes CONFIRMED
    And confirmed_at is stored
```

---

## 8) Reverted Transaction Handling
**Goal:** correctly finalize failed on-chain payout.

**Preconditions:** request is `SUBMITTED`; transaction is mined or being tracked.

**Steps:**
1. Worker receives a receipt with `reverted = true`.
2. Updates status to `FAILED`.
3. Stores `failed_reason`.

**Result:** failure is recorded; request is not considered confirmed.

**Gherkin**
```gherkin
Feature: Handle reverted payout

  Scenario: Mined transaction reverts
    Given a request is SUBMITTED with a tx_hash
    And the receipt indicates reverted true
    When workerTick processes the receipt
    Then the request status becomes FAILED
    And failed_reason is stored
```

---

## 9) Read Single Request Status
**Goal:** inspect current state of a payout request.

**Preconditions:** request `id` is known.

**Steps:**
1. Observer calls `payoutRequest(id)`.
2. API returns current status and relevant fields (tx data, reasons).

**Result:** transparent status tracking for one request.

**Gherkin**
```gherkin
Feature: Query single payout request

  Scenario: Observer reads request status
    Given a payout request exists
    When the observer queries payoutRequest by id
    Then the API returns the current request state
```

---

## 10) List Requests with Pagination
**Goal:** monitor payout queue/history.

**Preconditions:** API is available.

**Steps:**
1. Observer calls `payoutRequests(status, first, after)`.
2. API applies optional status filter and returns a cursor-based connection.

**Result:** paginated listing of requests and their states.

**Gherkin**
```gherkin
Feature: Query paginated payout requests

  Scenario: Observer reads first page by status
    Given payout requests exist
    When the observer queries payoutRequests with status and first
    Then the API returns a connection with edges and cursor pagination
```

---

## Allowed State Transitions (Invariant)
- `PENDING_RISK -> APPROVED | REJECTED`
- `APPROVED -> SUBMITTED | REJECTED`
- `SUBMITTED -> CONFIRMED | FAILED`

Any transition outside this list is invalid.
