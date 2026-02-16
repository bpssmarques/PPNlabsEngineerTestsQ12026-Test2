import {expect} from "chai";
import {createDb} from "../../../src/db/db";
import {PayoutRepo, PayoutRequestRow} from "../../../src/db/repo";
import {ChainClient, TxReceiptView} from "../../../src/worker/chain";
import {workerTick, WorkerContext} from "../../../src/worker/workerTick";
import riskConfig from "../../../candidate-pack/risk.json";

class MockChainClient implements ChainClient {
  public submitPayoutCalls: Array<{requestId: string; to: string; amount: string}> = [];
  public submitResult: {txHash: string} = {txHash: "0xabc123"};
  public receipt: TxReceiptView | null = null;
  public getReceiptCalls: string[] = [];

  async submitPayout(input: {requestId: string; to: string; amount: string}): Promise<{txHash: string}> {
    this.submitPayoutCalls.push(input);
    return this.submitResult;
  }

  async getReceipt(txHash: string): Promise<TxReceiptView | null> {
    this.getReceiptCalls.push(txHash);
    return this.receipt;
  }
}

function makeCtx(overrides: Partial<WorkerContext> & {repo: PayoutRepo; chain: ChainClient}): WorkerContext {
  return {
    now: 1_700_000_010,
    workerId: "test-worker",
    leaseMs: 60_000,
    ...overrides,
  };
}

describe("workerTick", function () {
  let repo: PayoutRepo;
  let chain: MockChainClient;
  const NOW = 1_700_000_000;
  const SAFE_ADDRESS = "0x00000000000000000000000000000000000000a1";
  const DENYLISTED_ADDRESS = riskConfig.denylist[0];

  beforeEach(async function () {
    const db = await createDb();
    repo = new PayoutRepo(db);
    chain = new MockChainClient();
  });

  function createPayoutRequest(overrides?: {to?: string; amount?: string; now?: number, approved: boolean}): PayoutRequestRow {
    const now = overrides?.now ?? NOW;
    const row = repo.create({
      to: overrides?.to ?? SAFE_ADDRESS,
      amount: overrides?.amount ?? "1000000",
      asset: "USDC",
      now,
    });
    if (overrides?.approved) {
      return repo.approve(row.id, now + 1)!;
    }
    return row;
  }

  describe("no work available", function () {
    it("returns none when no rows exist", async function () {
      const result = await workerTick(makeCtx({repo, chain, now: NOW}));
      expect(result).to.deep.equal({claimedId: null, action: "none"});
    });

    it("returns none when only PENDING_RISK rows exist", async function () {
      repo.create({to: SAFE_ADDRESS, amount: "1000000", asset: "USDC", now: NOW});
      const result = await workerTick(makeCtx({repo, chain, now: NOW + 1}));
      expect(result).to.deep.equal({claimedId: null, action: "none"});
    });
  });

  describe("submitted row priority", function () {
    it("picks up a SUBMITTED row before an APPROVED row", async function () {
      const approved = createPayoutRequest({approved: true});
      const submitted = createPayoutRequest();
      repo.updateStatus(submitted.id, "SUBMITTED", NOW + 2, {txHash: "0xsubmitted", submittedAt: NOW + 2});

      chain.receipt = {txHash: "0xsubmitted", confirmations: riskConfig.confirmations, reverted: false};

      const result = await workerTick(makeCtx({repo, chain, now: NOW + 10}));

      expect(result.claimedId).to.equal(submitted.id);
      expect(result.action).to.equal("confirmed");

      const approvedRow = repo.getById(approved.id)!;
      expect(approvedRow.status).to.equal("APPROVED");
    });
  });

  describe("risk check rejection", function () {
    it("rejects when recipient is denylisted", async function () {
      const row = repo.create({to: DENYLISTED_ADDRESS, amount: "1000000", asset: "USDC", now: NOW});
      repo.approve(row.id, NOW + 1);

      const result = await workerTick(makeCtx({repo, chain, now: NOW + 10}));

      expect(result.action).to.equal("rejected");
      expect(result.claimedId).to.equal(row.id);

      const updated = repo.getById(row.id)!;
      expect(updated.status).to.equal("REJECTED");
      expect(updated.riskReason).to.include("denylisted");
    });

    it("rejects when amount exceeds maxPerRequest", async function () {
      const overLimit = (BigInt(riskConfig.maxPerRequest) + 1n).toString();
      const row = repo.create({to: SAFE_ADDRESS, amount: overLimit, asset: "USDC", now: NOW});
      repo.approve(row.id, NOW + 1);

      const result = await workerTick(makeCtx({repo, chain, now: NOW + 10}));

      expect(result.action).to.equal("rejected");
      const updated = repo.getById(row.id)!;
      expect(updated.status).to.equal("REJECTED");
      expect(updated.riskReason).to.include("maxPerRequest");
    });

    it("rejects when daily total would exceed maxDailyTotal", async function () {
      // Manually insert SUBMITTED rows to fill the daily budget without going through workerTick
      const maxPerReq = BigInt(riskConfig.maxPerRequest);
      const maxDaily = BigInt(riskConfig.maxDailyTotal);
      const count = Number(maxDaily / maxPerReq);

      for (let i = 0; i < count; i++) {
        const row = repo.create({to: SAFE_ADDRESS, amount: maxPerReq.toString(), asset: "USDC", now: NOW});
        repo.approve(row.id, NOW + 1);
        repo.updateStatus(row.id, "SUBMITTED", NOW + 2, {txHash: `0xfill${i}`, submittedAt: NOW + 2});
        // Confirm so claimSubmitted won't pick them up
        repo.updateStatus(row.id, "CONFIRMED", NOW + 3, {confirmedAt: NOW + 3});
      }

      // This one should be rejected because daily total is already at the limit
      const overflow = createPayoutRequest({amount: "1", now: NOW + 10, approved: true});
      const result = await workerTick(makeCtx({repo, chain, now: NOW + 20}));

      expect(result.action).to.equal("rejected");
      const updated = repo.getById(overflow.id)!;
      expect(updated.status).to.equal("REJECTED");
      expect(updated.riskReason).to.include("maxDailyTotal");
    });

    it("passes risk checks and does not call chain for a rejected row", async function () {
      const row = repo.create({to: DENYLISTED_ADDRESS, amount: "1000000", asset: "USDC", now: NOW});
      repo.approve(row.id, NOW + 1);

      await workerTick(makeCtx({repo, chain, now: NOW + 10}));

      expect(chain.submitPayoutCalls).to.have.length(0);
    });
  });

  describe("transaction submission", function () {
    it("submits a payout transaction for a clean approved row", async function () {
      const row = createPayoutRequest({approved: true});

      chain.submitResult = {txHash: "0xtxhash123"};
      const result = await workerTick(makeCtx({repo, chain, now: NOW + 10}));

      expect(result.action).to.equal("submitted");
      expect(result.claimedId).to.equal(row.id);

      expect(chain.submitPayoutCalls).to.have.length(1);
      expect(chain.submitPayoutCalls[0].to).to.equal(SAFE_ADDRESS);
      expect(chain.submitPayoutCalls[0].amount).to.equal("1000000");

      const updated = repo.getById(row.id)!;
      expect(updated.status).to.equal("SUBMITTED");
      expect(updated.txHash).to.equal("0xtxhash123");
      expect(updated.submittedAt).to.equal(NOW + 10);
    });

    it("passes requestId from the row to the chain client", async function () {
      const row = createPayoutRequest({approved: true});

      await workerTick(makeCtx({repo, chain, now: NOW + 10}));

      expect(chain.submitPayoutCalls[0].requestId).to.equal(row.requestId);
    });
  });

  describe("confirmation tracking", function () {
    const LEASE = 100;
    let submittedRow: PayoutRequestRow;

    beforeEach(async function () {
      const row = createPayoutRequest({approved: true});
      chain.submitResult = {txHash: "0xtxhash"};
      await workerTick(makeCtx({repo, chain, now: NOW + 10, leaseMs: LEASE}));
      submittedRow = repo.getById(row.id)!;
      expect(submittedRow.status).to.equal("SUBMITTED");
    });

    it("returns none when receipt is not yet available", async function () {
      chain.receipt = null;
      const result = await workerTick(makeCtx({repo, chain, now: NOW + 10 + LEASE + 1, leaseMs: LEASE}));

      expect(result.action).to.equal("none");
      expect(result.claimedId).to.equal(submittedRow.id);

      const row = repo.getById(submittedRow.id)!;
      expect(row.status).to.equal("SUBMITTED");
    });

    it("marks as FAILED when transaction is reverted", async function () {
      chain.receipt = {txHash: "0xtxhash", confirmations: 10, reverted: true};
      const result = await workerTick(makeCtx({repo, chain, now: NOW + 10 + LEASE + 1, leaseMs: LEASE}));

      expect(result.action).to.equal("failed");
      expect(result.claimedId).to.equal(submittedRow.id);

      const row = repo.getById(submittedRow.id)!;
      expect(row.status).to.equal("FAILED");
      expect(row.failedReason).to.equal("transaction reverted");
    });

    it("marks as CONFIRMED when confirmations meet threshold", async function () {
      chain.receipt = {txHash: "0xtxhash", confirmations: riskConfig.confirmations, reverted: false};
      const tickNow = NOW + 10 + LEASE + 1;
      const result = await workerTick(makeCtx({repo, chain, now: tickNow, leaseMs: LEASE}));

      expect(result.action).to.equal("confirmed");
      expect(result.claimedId).to.equal(submittedRow.id);

      const row = repo.getById(submittedRow.id)!;
      expect(row.status).to.equal("CONFIRMED");
      expect(row.confirmedAt).to.equal(tickNow);
    });

    it("marks as CONFIRMED when confirmations exceed threshold", async function () {
      chain.receipt = {txHash: "0xtxhash", confirmations: riskConfig.confirmations + 5, reverted: false};
      const result = await workerTick(makeCtx({repo, chain, now: NOW + 10 + LEASE + 1, leaseMs: LEASE}));

      expect(result.action).to.equal("confirmed");
    });

    it("returns none when confirmations are below threshold", async function () {
      chain.receipt = {txHash: "0xtxhash", confirmations: riskConfig.confirmations - 1, reverted: false};
      const result = await workerTick(makeCtx({repo, chain, now: NOW + 10 + LEASE + 1, leaseMs: LEASE}));

      expect(result.action).to.equal("none");
      expect(result.claimedId).to.equal(submittedRow.id);

      const row = repo.getById(submittedRow.id)!;
      expect(row.status).to.equal("SUBMITTED");
    });

    it("calls getReceipt with the correct txHash", async function () {
      chain.receipt = null;
      await workerTick(makeCtx({repo, chain, now: NOW + 10 + LEASE + 1, leaseMs: LEASE}));

      expect(chain.getReceiptCalls).to.include("0xtxhash");
    });
  });

  describe("restart recovery", function () {
    it("recovers an APPROVED row that already has a txHash", async function () {
      const row = createPayoutRequest();

      // Simulate a crash: the row has a txHash from a previous run but status is still APPROVED
      repo.updateStatus(row.id, "APPROVED", NOW + 5, {txHash: "0xorphan", submittedAt: NOW + 3});

      chain.receipt = {txHash: "0xorphan", confirmations: riskConfig.confirmations, reverted: false};

      const result = await workerTick(makeCtx({repo, chain, now: NOW + 20}));

      // Should NOT have called submitPayout since txHash already exists
      expect(chain.submitPayoutCalls).to.have.length(0);

      expect(result.action).to.equal("confirmed");
      const updated = repo.getById(row.id)!;
      expect(updated.status).to.equal("CONFIRMED");
    });

    it("preserves original submittedAt during recovery", async function () {
      const row = createPayoutRequest();
      const originalSubmittedAt = NOW + 3;
      repo.updateStatus(row.id, "APPROVED", NOW + 5, {txHash: "0xorphan", submittedAt: originalSubmittedAt});

      chain.receipt = null;

      await workerTick(makeCtx({repo, chain, now: NOW + 20}));

      const updated = repo.getById(row.id)!;
      expect(updated.status).to.equal("SUBMITTED");
      expect(updated.submittedAt).to.equal(originalSubmittedAt);
    });

    it("sets submittedAt to now when original is missing during recovery", async function () {
      const row = createPayoutRequest();
      repo.updateStatus(row.id, "APPROVED", NOW + 5, {txHash: "0xorphan"});

      chain.receipt = null;

      const recoveryNow = NOW + 20;
      await workerTick(makeCtx({repo, chain, now: recoveryNow}));

      const updated = repo.getById(row.id)!;
      expect(updated.status).to.equal("SUBMITTED");
      expect(updated.submittedAt).to.equal(recoveryNow);
    });

    it("marks recovered row as FAILED if tx reverted", async function () {
      const row = createPayoutRequest();
      repo.updateStatus(row.id, "APPROVED", NOW + 5, {txHash: "0xorphan", submittedAt: NOW + 3});

      chain.receipt = {txHash: "0xorphan", confirmations: 10, reverted: true};

      const result = await workerTick(makeCtx({repo, chain, now: NOW + 20}));

      expect(result.action).to.equal("failed");
      const updated = repo.getById(row.id)!;
      expect(updated.status).to.equal("FAILED");
      expect(updated.failedReason).to.equal("transaction reverted");
    });
  });

  describe("lease locking", function () {
    it("does not pick up an APPROVED row locked by another worker", async function () {
      const row = createPayoutRequest({approved: true});

      // First worker claims it
      const result1 = await workerTick(makeCtx({repo, chain, now: NOW + 10, workerId: "worker-1"}));
      expect(result1.claimedId).to.equal(row.id);

      // Second worker finds nothing (lease not expired)
      const result2 = await workerTick(makeCtx({repo, chain, now: NOW + 11, workerId: "worker-2"}));
      expect(result2).to.deep.equal({claimedId: null, action: "none"});
    });

    it("picks up a row after lease expires", async function () {
      const row = createPayoutRequest({approved: true});

      // First worker claims it but "crashes" (lease = 60s)
      await workerTick(makeCtx({repo, chain, now: NOW + 10, workerId: "worker-1", leaseMs: 60_000}));

      // Reset the status back to APPROVED to simulate lease expiration scenario
      repo.updateStatus(row.id, "APPROVED", NOW + 10);

      // Second worker picks it up after lease expires
      const result = await workerTick(
        makeCtx({repo, chain, now: NOW + 10 + 60_001, workerId: "worker-2", leaseMs: 60_000})
      );
      expect(result.claimedId).to.equal(row.id);
    });
  });


  describe("processing order", function () {
    it("claims the oldest approved row first", async function () {
      const first = createPayoutRequest({now: NOW, approved: true});
      const _second = createPayoutRequest({now: NOW + 100, approved: true});

      chain.submitResult = {txHash: "0xfirst"};
      const result = await workerTick(makeCtx({repo, chain, now: NOW + 200}));

      expect(result.claimedId).to.equal(first.id);
    });

    it("processes one row per tick", async function () {
      createPayoutRequest({now: NOW, approved: true});
      createPayoutRequest({now: NOW + 100, approved: true});

      chain.submitResult = {txHash: "0xone"};
      const result = await workerTick(makeCtx({repo, chain, now: NOW + 200}));

      expect(result.action).to.equal("submitted");
      expect(chain.submitPayoutCalls).to.have.length(1);
    });
  });


  describe("full lifecycle", function () {
    it("takes a row from APPROVED through SUBMITTED to CONFIRMED across ticks", async function () {
      const LEASE = 100;
      const row = createPayoutRequest({approved: true});

      // Tick 1: submit
      chain.submitResult = {txHash: "0xlifecycle"};
      let t = NOW + 10;
      const r1 = await workerTick(makeCtx({repo, chain, now: t, leaseMs: LEASE}));
      expect(r1.action).to.equal("submitted");

      // Tick 2: receipt not ready (after lease expires)
      chain.receipt = null;
      t += LEASE + 1;
      const r2 = await workerTick(makeCtx({repo, chain, now: t, leaseMs: LEASE}));
      expect(r2.action).to.equal("none");

      // Tick 3: not enough confirmations
      chain.receipt = {txHash: "0xlifecycle", confirmations: 1, reverted: false};
      t += LEASE + 1;
      const r3 = await workerTick(makeCtx({repo, chain, now: t, leaseMs: LEASE}));
      expect(r3.action).to.equal("none");

      // Tick 4: confirmed
      chain.receipt = {txHash: "0xlifecycle", confirmations: riskConfig.confirmations, reverted: false};
      t += LEASE + 1;
      const r4 = await workerTick(makeCtx({repo, chain, now: t, leaseMs: LEASE}));
      expect(r4.action).to.equal("confirmed");

      const final = repo.getById(row.id)!;
      expect(final.status).to.equal("CONFIRMED");
      expect(final.txHash).to.equal("0xlifecycle");
      expect(final.confirmedAt).to.equal(t);
    });
  });
});
