import {IChainClient} from "../interfaces/IChainClient";
import {IPayoutRepository} from "../interfaces/IPayoutRepository";
import {IRiskChecker} from "../interfaces/IRiskChecker";
import {WorkerContext, WorkerResult} from "../types/worker.types";
import {RiskConfig} from "../types/risk.types";

export class PayoutWorker {
  constructor(
    private readonly repo: IPayoutRepository,
    private readonly chain: IChainClient,
    private readonly riskChecker: IRiskChecker,
    private readonly riskConfig: RiskConfig
  ) {}

  /**
   * Process one payout request (idempotent)
   * Safe to call multiple times or concurrently
   */
  async tick(ctx: WorkerContext): Promise<WorkerResult> {
    const {now, workerId, leaseMs} = ctx;

    // Step 1: Claim exactly one approved request
    const claimed = this.repo.claimApproved(now, workerId, leaseMs);
    if (!claimed) {
      console.log(`[${workerId}] No approved requests to claim`);
      return {claimedId: null, action: "none"};
    }

    // Step 2: Run risk checks
    const dailyTotal = this.repo.getDailyTotal(now);
    const riskResult = this.riskChecker.check(claimed, dailyTotal);

    if (!riskResult.ok) {
      console.log(`[${workerId}] REJECTED ${claimed.id}: ${riskResult.reason}`);
      this.repo.updateStatus(claimed.id, "REJECTED", now, {
        riskReason: riskResult.reason
      });
      return {claimedId: claimed.id, action: "rejected"};
    }
    console.log(`[${workerId}] Risk check passed for ${claimed.id}`);

    // Step 3: Transaction submission (idempotent)
    if (!claimed.txHash) {
      console.log(`[${workerId}] Submitting tx for ${claimed.id} (to: ${claimed.to}, amount: ${claimed.amount})`);
      const {txHash} = await this.chain.submitPayout({
        requestId: claimed.requestId,
        to: claimed.to,
        amount: claimed.amount
      });
      console.log(`[${workerId}] SUBMITTED ${claimed.id}: txHash=${txHash}`);
      this.repo.updateStatus(claimed.id, "SUBMITTED", now, {
        txHash,
        submittedAt: now
      });
      return {claimedId: claimed.id, action: "submitted"};
    }
    console.log(`[${workerId}] Tx already submitted for ${claimed.id}: ${claimed.txHash}`);

    // Step 4: Confirmation tracking
    const receipt = await this.chain.getReceipt(claimed.txHash);
    if (!receipt) {
      console.log(`[${workerId}] Waiting for receipt: ${claimed.txHash}`);
      return {claimedId: claimed.id, action: "none"};
    }
    console.log(`[${workerId}] Receipt found for ${claimed.txHash}: confirmations=${receipt.confirmations}, reverted=${receipt.reverted}`);

    // Step 5: Failure handling
    if (receipt.reverted) {
      console.log(`[${workerId}] FAILED ${claimed.id}: Transaction reverted`);
      this.repo.updateStatus(claimed.id, "FAILED", now, {
        failedReason: "Transaction reverted"
      });
      return {claimedId: claimed.id, action: "failed"};
    }

    // Step 6: Confirmation check
    if (receipt.confirmations >= this.riskConfig.confirmations) {
      console.log(`[${workerId}] CONFIRMED ${claimed.id}: ${receipt.confirmations}/${this.riskConfig.confirmations} confirmations`);
      this.repo.updateStatus(claimed.id, "CONFIRMED", now, {
        confirmedAt: now
      });
      return {claimedId: claimed.id, action: "confirmed"};
    }

    console.log(`[${workerId}] Waiting for confirmations: ${receipt.confirmations}/${this.riskConfig.confirmations}`);
    return {claimedId: claimed.id, action: "none"};
  }
}
