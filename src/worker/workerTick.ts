import riskConfig from "../../candidate-pack/risk.json";
import {ChainClient} from "./chain";
import {PayoutRepo} from "../db/repo";
import {runRiskChecks} from "./risk";

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

const config = riskConfig as {confirmations: number};

function getUtcDateString(nowSeconds: number): string {
  return new Date(nowSeconds * 1000).toISOString().slice(0, 10);
}

export async function workerTick(ctx: WorkerContext): Promise<WorkerResult> {
  const row = ctx.repo.claimOneApproved(ctx.now, ctx.workerId, ctx.leaseMs);
  if (!row) {
    return {claimedId: null, action: "none"};
  }

  const dailyTotal = ctx.repo.getDailyTotalForUtcDate(getUtcDateString(ctx.now));
  const risk = runRiskChecks(row, dailyTotal);
  if (!risk.ok) {
    ctx.repo.updateStatus(row.id, "REJECTED", ctx.now, {riskReason: risk.reason ?? "risk check failed"});
    return {claimedId: row.id, action: "rejected"};
  }

  if (row.txHash) {
    const receipt = await ctx.chain.getReceipt(row.txHash);
    if (receipt) {
      if (receipt.reverted) {
        ctx.repo.updateStatus(row.id, "FAILED", ctx.now, {failedReason: "tx reverted"});
        return {claimedId: row.id, action: "failed"};
      }
      const requiredConfirmations = config.confirmations ?? 1;
      if (receipt.confirmations >= requiredConfirmations) {
        ctx.repo.updateStatus(row.id, "CONFIRMED", ctx.now, {confirmedAt: ctx.now});
        return {claimedId: row.id, action: "confirmed"};
      }
    }
    return {claimedId: row.id, action: "submitted"};
  }

  const {txHash} = await ctx.chain.submitPayout({
    requestId: row.requestId,
    to: row.to,
    amount: row.amount
  });
  ctx.repo.updateStatus(row.id, "SUBMITTED", ctx.now, {txHash, submittedAt: ctx.now});
  return {claimedId: row.id, action: "submitted"};
}
