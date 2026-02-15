import { ChainClient } from "./chain";
import { PayoutRepo } from "../db/repo";
import riskConfig from "../../candidate-pack/risk.json";
import { runRiskChecks } from "./risk";
import { createLogger } from "../shared/logger";

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

const SECONDS_PER_DAY = 86_400;
const logger = createLogger("workerTick");

// epochSeconds is expected to be a Unix timestamp in whole seconds (UTC).
// This snaps the timestamp to the start of the corresponding UTC day (00:00:00),
// returning [start, endExclusive) bounds in seconds since the Unix epoch.
function getUtcDayBounds(epochSeconds: number): { start: number; endExclusive: number } {
  const dayKey = Math.floor(epochSeconds / SECONDS_PER_DAY) * SECONDS_PER_DAY;
  return { start: dayKey, endExclusive: dayKey + SECONDS_PER_DAY };
}

export async function workerTick(ctx: WorkerContext): Promise<WorkerResult> {
  const approvedClaim = ctx.repo.claimApproved(ctx.now, ctx.workerId, ctx.leaseMs);
  let claimed = approvedClaim;
  if (!claimed) {
    claimed = ctx.repo.claimSubmitted(ctx.now, ctx.workerId, ctx.leaseMs);
  }
  if (!claimed) {
    return { claimedId: null, action: "none" };
  }

  let action: WorkerResult["action"] = "none";
  let currentStatus = claimed.status;

  try {
    let row = claimed;

    if (row.status === "APPROVED") {
      const { start, endExclusive } = getUtcDayBounds(ctx.now);
      const dailyTotal = ctx.repo.getDailyTotal(start, endExclusive);
      const risk = runRiskChecks(row, dailyTotal);

      if (!risk.ok) {
        ctx.repo.updateStatus(row.id, "REJECTED", ctx.now, { riskReason: risk.reason ?? "risk-check-failed" });
        return { claimedId: row.id, action: "rejected" };
      }

      if (row.txHash == null) {
        const submission = await ctx.chain.submitPayout({ requestId: row.requestId, to: row.to, amount: row.amount });
        const updated = ctx.repo.updateStatus(row.id, "SUBMITTED", ctx.now, {
          txHash: submission.txHash,
          submittedAt: ctx.now
        });

        if (!updated) {
          ctx.repo.updateStatus(row.id, "REJECTED", ctx.now, { riskReason: "failed-to-persist-submission" });
          return { claimedId: row.id, action: "rejected" };
        }

        row = updated;
        currentStatus = row.status;
        action = "submitted";
      } else {
        const existingReceipt = await ctx.chain.getReceipt(row.txHash);
        if (!existingReceipt) {
          ctx.repo.updateStatus(row.id, "REJECTED", ctx.now, {
            riskReason: "txhash-not-found-on-chain"
          });
          return { claimedId: row.id, action: "rejected" };
        }
        const markedSubmitted = ctx.repo.updateStatus(row.id, "SUBMITTED", ctx.now, {
          submittedAt: row.submittedAt ?? ctx.now
        });
        if (!markedSubmitted) {
          return { claimedId: row.id, action };
        }
        row = markedSubmitted;
        currentStatus = row.status;
      }
    }
    if (row.status === "SUBMITTED" && row.txHash) {
      try {
        const receipt = await ctx.chain.getReceipt(row.txHash);
        if (receipt) {
          if (receipt.reverted) {
            ctx.repo.updateStatus(row.id, "FAILED", ctx.now, { failedReason: "transaction-reverted" });
            return { claimedId: row.id, action: "failed" };
          }

          if (receipt.confirmations >= riskConfig.confirmations) {
            ctx.repo.updateStatus(row.id, "CONFIRMED", ctx.now, { confirmedAt: ctx.now });
            return { claimedId: row.id, action: "confirmed" };
          }
        }
      } catch (err) {
        logger.error("receipt-fetch-failed", {
          workerId: ctx.workerId,
          payoutId: row.id,
          txHash: row.txHash,
          error: err
        });
        throw new Error("receipt-fetch-failed");
      }
    }

    return { claimedId: row.id, action };
  } catch (error) {
    const message = error instanceof Error ? error.message : "worker-error";
    if (currentStatus === "SUBMITTED") {
      ctx.repo.updateStatus(claimed.id, "FAILED", ctx.now, { failedReason: message });
      return { claimedId: claimed.id, action: "failed" };
    }

    ctx.repo.updateStatus(claimed.id, "REJECTED", ctx.now, { riskReason: message });
    return { claimedId: claimed.id, action: "rejected" };
  } finally {
    ctx.repo.releaseLock(claimed.id, ctx.workerId, ctx.now);
  }
}
