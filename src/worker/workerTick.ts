import {ChainClient} from "./chain";
import {PayoutRepo, PayoutRequestRow} from "../db/repo";
import {runRiskChecks} from "./risk";
import riskConfig from "../../candidate-pack/risk.json";

export interface WorkerContext {
  repo: PayoutRepo;
  chain: ChainClient;
  now: number;
  workerId: string;
  leaseMs: number;
}

export interface WorkerResult {
  claimedId: string | null;
  action: "none" | "rejected" | "submitted" | "confirmed" | "failed";
}

export async function workerTick(ctx: WorkerContext): Promise<WorkerResult> {
  const {repo, chain, now, workerId, leaseMs} = ctx;

  // Pick up any SUBMITTED request that needs confirmation tracking
  const submitted = repo.claimSubmitted(now, workerId, leaseMs);
  if (submitted) {
    return handleConfirmation(submitted, repo, chain, now);
  }

  // Claim an APPROVED request for processing
  const claimed = repo.claimApproved(now, workerId, leaseMs);
  if (!claimed) {
    return {claimedId: null, action: "none"};
  }

  // Run risk checks
  const dailyTotal = repo.getDailyTotal(now);
  const riskResult = runRiskChecks(claimed, dailyTotal);
  if (!riskResult.ok) {
    repo.updateStatus(claimed.id, "REJECTED", now, {riskReason: riskResult.reason});
    return {claimedId: claimed.id, action: "rejected"};
  }

  // Transaction submission (idempotent — skip if tx_hash exists)
  if (!claimed.txHash) {
    const {txHash} = await chain.submitPayout({
      requestId: claimed.requestId,
      to: claimed.to,
      amount: claimed.amount,
    });
    repo.updateStatus(claimed.id, "SUBMITTED", now, {txHash, submittedAt: now});
    return {claimedId: claimed.id, action: "submitted"};
  }

  // Phase 5: Restart recovery — tx_hash exists but status is still APPROVED.
  // Transition to SUBMITTED and proceed to confirmation tracking.
  repo.updateStatus(claimed.id, "SUBMITTED", now, {submittedAt: claimed.submittedAt ?? now});
  return handleConfirmation(repo.getById(claimed.id)!, repo, chain, now);
}

async function handleConfirmation(
  row: PayoutRequestRow,
  repo: PayoutRepo,
  chain: ChainClient,
  now: number
): Promise<WorkerResult> {
  const receipt = await chain.getReceipt(row.txHash!);

  if (!receipt) {
    // Transaction not yet mined, nothing to do this tick.
    return {claimedId: row.id, action: "none"};
  }

  if (receipt.reverted) {
    repo.updateStatus(row.id, "FAILED", now, {failedReason: "transaction reverted"});
    return {claimedId: row.id, action: "failed"};
  }

  if (receipt.confirmations >= riskConfig.confirmations) {
    repo.updateStatus(row.id, "CONFIRMED", now, {confirmedAt: now});
    return {claimedId: row.id, action: "confirmed"};
  }

  // Not enough confirmations yet, wait for next tick.
  return {claimedId: row.id, action: "none"};
}
