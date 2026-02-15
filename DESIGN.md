# Design Doc

## What Actually Matters

**No double-pays.** That's it. Everything else is just making sure this holds.

On-chain: `requestExecuted[requestId]` mapping. Can't execute same request twice.

Off-chain: Check `if (!claimed.txHash)` before submitting. Once we have a txHash, never submit again.

## How the Worker Works

1. Grab one approved request (with a lease lock so other workers don't grab it)
2. Run risk checks (amount limits, daily total, denylist)
3. If no txHash yet → submit transaction, save txHash
4. If txHash exists → check confirmations
5. Mark CONFIRMED or FAILED when done

The worker can crash at any point and restart safely because:
- State is in the database, not memory
- We check txHash before resubmitting
- Contract rejects duplicate requestIds anyway

## Locking

Simple lease system: when we claim a request, we set `lock_expires_at = now + 60s`. Other workers skip locked requests unless the lease expired.

If a worker dies mid-processing, the lease expires and another worker picks it up. No problem because of the txHash check.

## Daily Limit

"Today" = UTC day starting at midnight (00:00:00).

We sum amounts from requests with status SUBMITTED or CONFIRMED created today. Before approving a new payout, we check if `dailyTotal + newAmount > maxDailyTotal`.

## Worst Case

Worker crashes right after `submitPayout()` but before saving txHash to DB.

What happens:
- Tx is on-chain or in mempool
- DB still says txHash=NULL
- Next worker tries to submit again

Result:
- Contract rejects the duplicate (requestId already used)
- We waste some gas but no double-pay

Could fix with write-ahead logging but not worth the complexity for this scope.

## What I'd Fix Next

1. **Atomic DB transactions** - Wrap claim+update in BEGIN/COMMIT so we don't get partial state
2. **Retry logic** - Right now if submission fails (network error), request gets stuck. Should retry N times then mark FAILED
3. **Better logging** - Added console.log everywhere so CI logs show what's happening. Would use structured JSON logs in prod
4. **Gas optimization** - Currently using default gas. Should query oracle and implement tx replacement for stuck txs

## Security

On-chain:
- Role-based access (only OPERATOR can payout)
- Pausable (admin can stop everything)
- Replay protection (requestExecuted mapping)

Off-chain:
- Parameterized SQL queries (no injection)
- Address normalization (toLowerCase) for denylist
- State machine validation (can't approve unless PENDING_RISK)

## Testing

All tests pass. Logging added to worker, risk checker, DB repo, and GraphQL resolvers so you can see what's happening in CI output.
