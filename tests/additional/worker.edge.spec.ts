import { expect } from "chai";
import { createDb } from "../../src/db/db";
import { PayoutRepo } from "../../src/db/repo";
import { ChainClient, TxReceiptView, computeDeterministicFakeTxHash } from "../../src/worker/chain";
import { workerTick } from "../../src/worker/workerTick";
import riskConfig from "../../candidate-pack/risk.json";

class TrackingChainClient implements ChainClient {
  submitCalls = 0;
  private readonly receiptByHash: Map<string, TxReceiptView | null>;
  private readonly shouldThrowOnReceipt: boolean;

  constructor(receiptByHash: Map<string, TxReceiptView | null> = new Map(), shouldThrowOnReceipt = false) {
    this.receiptByHash = receiptByHash;
    this.shouldThrowOnReceipt = shouldThrowOnReceipt;
  }

  async submitPayout(input: { requestId: string; to: string; amount: string }): Promise<{ txHash: string }> {
    this.submitCalls += 1;
    return { txHash: computeDeterministicFakeTxHash(input) };
  }

  async getReceipt(txHash: string): Promise<TxReceiptView | null> {
    if (this.shouldThrowOnReceipt) {
      throw new Error("receipt-fetch-failed");
    }
    return this.receiptByHash.get(txHash) ?? null;
  }
}

describe("workerTick edge scenarios", function () {
  it("rejects request when recipient is denylisted", async function () {
    const db = await createDb();
    const repo = new PayoutRepo(db);
    const now = 1_700_000_000;

    const created = repo.create({
      to: riskConfig.denylist[0],
      amount: "100",
      asset: "USDC",
      now
    });
    repo.approve(created.id, now + 1);

    const result = await workerTick({
      repo,
      chain: new TrackingChainClient(),
      now: now + 2,
      workerId: "worker-1",
      leaseMs: 60_000
    });

    expect(result.action).to.equal("rejected");
    const updated = repo.getById(created.id);
    expect(updated?.status).to.equal("REJECTED");
    expect(updated?.riskReason).to.equal("recipient is denylisted");
  });

  it("does not resubmit when tx_hash already exists and confirms by receipt", async function () {
    const db = await createDb();
    const repo = new PayoutRepo(db);
    const now = 1_700_000_000;
    const existingTxHash = "0xabc123";

    const created = repo.create({
      to: "0x00000000000000000000000000000000000000a1",
      amount: "100",
      asset: "USDC",
      now
    });
    repo.approve(created.id, now + 1);
    repo.updateStatus(created.id, "APPROVED", now + 1, { txHash: existingTxHash });

    const chain = new TrackingChainClient(
      new Map([
        [
          existingTxHash,
          {
            txHash: existingTxHash,
            confirmations: riskConfig.confirmations,
            reverted: false
          }
        ]
      ])
    );

    const result = await workerTick({
      repo,
      chain,
      now: now + 2,
      workerId: "worker-1",
      leaseMs: 60_000
    });

    expect(chain.submitCalls).to.equal(0);
    expect(result.action).to.equal("confirmed");

    const updated = repo.getById(created.id);
    expect(updated?.status).to.equal("CONFIRMED");
    expect(updated?.confirmedAt).to.equal(now + 2);
  });

  it("marks request FAILED when tx receipt is reverted", async function () {
    const db = await createDb();
    const repo = new PayoutRepo(db);
    const now = 1_700_000_000;

    const created = repo.create({
      to: "0x00000000000000000000000000000000000000a1",
      amount: "100",
      asset: "USDC",
      now
    });
    repo.approve(created.id, now + 1);

    const txHash = computeDeterministicFakeTxHash({
      requestId: created.requestId,
      to: created.to,
      amount: created.amount
    });

    const chain = new TrackingChainClient(
      new Map([
        [
          txHash,
          {
            txHash,
            confirmations: riskConfig.confirmations,
            reverted: true
          }
        ]
      ])
    );

    const result = await workerTick({
      repo,
      chain,
      now: now + 2,
      workerId: "worker-1",
      leaseMs: 60_000
    });

    expect(result.action).to.equal("failed");
    const updated = repo.getById(created.id);
    expect(updated?.status).to.equal("FAILED");
    expect(updated?.failedReason).to.equal("transaction-reverted");
  });

  it("marks SUBMITTED as FAILED when receipt fetch throws", async function () {
    const db = await createDb();
    const repo = new PayoutRepo(db);
    const now = 1_700_000_000;

    const created = repo.create({
      to: "0x00000000000000000000000000000000000000a1",
      amount: "100",
      asset: "USDC",
      now
    });
    repo.approve(created.id, now + 1);

    await workerTick({
      repo,
      chain: new TrackingChainClient(),
      now: now + 2,
      workerId: "worker-1",
      leaseMs: 60_000
    });

    const submittedRow = repo.getById(created.id);
    expect(submittedRow?.status).to.equal("SUBMITTED");

    const result = await workerTick({
      repo,
      chain: new TrackingChainClient(new Map(), true),
      now: now + 3,
      workerId: "worker-2",
      leaseMs: 60_000
    });

    expect(result.action).to.equal("failed");
    const failedRow = repo.getById(created.id);
    expect(failedRow?.status).to.equal("FAILED");
    expect(failedRow?.failedReason).to.equal("receipt-fetch-failed");
  });
});
