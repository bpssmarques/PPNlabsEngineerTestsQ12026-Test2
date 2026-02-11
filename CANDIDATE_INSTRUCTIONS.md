
```markdown
<!-- CANDIDATE_TEST2.md -->

# PPN Labs — Engineering Take‑Home Test 2 (Hard / Longer)
**Title:** Settlement Orchestrator (Contract + API + Worker) with Idempotent Tx Handling  
**Timebox:** Hard/long (partial completion is expected; prioritize correctness and document tradeoffs)  
**Submission:** GitHub Pull Request only

## 1) How to submit
1. You will receive a private GitHub repository link.
2. Create a branch named `submission`.
3. Push your changes to that branch.
4. Open a Pull Request into `main` titled: `Test 2 Submission — <Your Name>`.

**Important:** Reviewers will evaluate your PR using:
- PR diff
- GitHub Actions checks + logs
- the GitHub Actions Job Summary
- an uploaded CI artifact (`ppn-deliverables`)

Reviewers will **not** install or run your code locally, so CI must be green.

---

## 2) Rules & constraints (read carefully)
### Forbidden edits (do not change)
- `.github/workflows/**`
- `candidate-pack/**`
- Baseline tests under:
  - `tests/**`
  - `contracts/test/**`

If you want to add extra tests, only add new files under:
- `tests/additional/**`
- `contracts/test/additional/**`

### Allowed edits
- `src/**`
- `contracts/**` (excluding baseline tests)
- `DESIGN.md` (you must create this)

---

## 3) Scenario
Build a minimal payout system where:
- A vault smart contract holds ERC20 funds and allows controlled payouts.
- A GraphQL API creates and approves payout requests and exposes status/history.
- A worker process:
  - runs risk checks
  - submits on-chain transactions
  - tracks confirmations
  - is **idempotent** (safe across restarts and concurrent runs)

---

## 4) Required state machine
Statuses:
- `PENDING_RISK`
- `APPROVED`
- `REJECTED`
- `SUBMITTED`
- `CONFIRMED`
- `FAILED` (transaction mined but reverted)

Allowed transitions:
- `PENDING_RISK -> APPROVED | REJECTED`
- `APPROVED -> SUBMITTED | REJECTED`
- `SUBMITTED -> CONFIRMED | FAILED`

---

## 5) What you are given
The repo includes:
- Contract skeleton: `contracts/SettlementVault.sol`
- Contract tests: `contracts/test/**`
- SQLite schema and repository layer: `src/db/**`
- Apollo GraphQL skeleton: `src/api/**`
- Worker skeleton: `src/worker/**`
- Candidate‑specific risk config (do not edit): `candidate-pack/risk.json`

---

## 6) What you need to do

### Task A — Implement the smart contract (required)
**File:** `contracts/SettlementVault.sol`

Requirements:
- Roles:
  - `ADMIN`: manage operators, pause/unpause
  - `OPERATOR`: execute payouts
- Function:
  - `payout(address to, uint256 amount, bytes32 requestId)`
- Replay protection:
  - each `requestId` can be executed **once**
- Event:
  - `PayoutExecuted(bytes32 requestId, address operator, address to, uint256 amount)`
- Operational safety:
  - payouts must be blocked while paused
- ERC20 transfer:
  - vault transfers ERC20 out to `to`

**Acceptance**
- `pnpm test:contracts` passes in GitHub Actions.

---

### Task B — Implement the GraphQL API (required)
Apollo is tested **in-process**; no HTTP server required.

You must implement:
- `mutation createPayoutRequest(to, amount, asset): PayoutRequest!`
  - Insert a row with status `PENDING_RISK`
- `mutation approvePayoutRequest(id): PayoutRequest!`
  - Transition request to `APPROVED`
- `query payoutRequest(id): PayoutRequest`
- `query payoutRequests(status, first, after): PayoutRequestConnection!` (cursor pagination)

**Acceptance**
- GitHub Actions API/GraphQL tests pass.

---

### Task C — Implement the worker orchestration (required)
**File:** `src/worker/workerTick.ts`

The worker must process approved requests with idempotency and safety.

#### Required behavior
1) **Claim exactly one request per tick**
- Select a request with `status = APPROVED`
- Use a lease lock:
  - lock is available when `lock_expires_at` is null or `< now`
  - set `lock_owner` and `lock_expires_at = now + leaseMs`
- The claim must be atomic (transactional).

2) **Risk checks**
Enforce `candidate-pack/risk.json`:
- `maxPerRequest`
- `maxDailyTotal` (define “today” in UTC and document it in DESIGN)
- `denylist`
- `confirmations`

If risk fails:
- set `REJECTED` and `risk_reason`

3) **Transaction submission**
If risk passes:
- if `tx_hash` is null:
  - submit the payout transaction on-chain
  - set status to `SUBMITTED`
  - store `tx_hash` and `submitted_at`
- if `tx_hash` exists:
  - do **not** resubmit
  - proceed to confirmation tracking

4) **Confirmation tracking**
- When the tx has at least `confirmations`:
  - set `CONFIRMED` and `confirmed_at`

5) **Failure handling**
- If the tx is mined but reverted:
  - set `FAILED` and `failed_reason`

#### Idempotency requirements
Your worker must be safe if:
- it crashes and restarts after submission (tx_hash exists but not confirmed)
- `workerTick()` is called multiple times or concurrently
- the same request is attempted twice (must not double-pay)

**Acceptance**
- GitHub Actions integration tests pass.
- Hidden tests will include concurrency and restart scenarios.

---

## 7) Required written deliverable
Create `DESIGN.md` (1–2 pages) and answer:

1. **Invariants:** What are the critical invariants your implementation preserves?
2. **Worst edge case:** What is the single most dangerous edge case, and how is it handled?
3. **Next improvements:** If you had 1 more day, what would you harden and why?

Include (briefly) in DESIGN:
- Your idempotency strategy
- Your locking strategy
- Your threat model (what can go wrong on-chain/off-chain and what you did about it)

---

## 8) How to run locally (for you)
These commands should work:
- `pnpm i`
- `pnpm test`
- `pnpm test:contracts`

---

## 9) What “done” looks like
- PR opened from `submission` into `main`
- GitHub Actions is green
- `DESIGN.md` is present and answers the prompts
- You did not modify forbidden paths
