import {expect} from "chai";
import {createDb} from "../../src/db/db";
import {PayoutRepo} from "../../src/db/repo";
import {FakeChainClient} from "../../src/worker/chain";
import {workerTick} from "../../src/worker/workerTick";

describe("Worker Edge Cases", function () {
  it("rejects payout exceeding maxPerRequest", async function () {
    const db = await createDb();
    const repo = new PayoutRepo(db);
    const now = 1_700_000_000;

    const created = repo.create({
      to: "0x00000000000000000000000000000000000000a1",
      amount: "30000000", // Exceeds maxPerRequest (25000000)
      asset: "USDC",
      now
    });
    repo.approve(created.id, now + 1);

    const result = await workerTick({
      repo,
      chain: new FakeChainClient(),
      now: now + 2,
      workerId: "worker-1",
      leaseMs: 60_000
    });

    expect(result.action).to.equal("rejected");
    const updated = repo.getById(created.id);
    expect(updated?.status).to.equal("REJECTED");
    expect(updated?.riskReason).to.include("maxPerRequest");
  });

  it("rejects payout to denylisted address", async function () {
    const db = await createDb();
    const repo = new PayoutRepo(db);
    const now = 1_700_000_000;

    const created = repo.create({
      to: "0x00000000000000000000000000000000000000dE", // In denylist
      amount: "1000000",
      asset: "USDC",
      now
    });
    repo.approve(created.id, now + 1);

    const result = await workerTick({
      repo,
      chain: new FakeChainClient(),
      now: now + 2,
      workerId: "worker-1",
      leaseMs: 60_000
    });

    expect(result.action).to.equal("rejected");
    const updated = repo.getById(created.id);
    expect(updated?.status).to.equal("REJECTED");
    expect(updated?.riskReason).to.include("denylist");
  });

  it("does not resubmit transaction if txHash already exists", async function () {
    const db = await createDb();
    const repo = new PayoutRepo(db);
    const now = 1_700_000_000;

    const created = repo.create({
      to: "0x00000000000000000000000000000000000000a1",
      amount: "1000000",
      asset: "USDC",
      now
    });
    repo.approve(created.id, now + 1);

    // First tick - submits transaction
    const chain = new FakeChainClient();
    await workerTick({
      repo,
      chain,
      now: now + 2,
      workerId: "worker-1",
      leaseMs: 60_000
    });

    const afterFirst = repo.getById(created.id);
    expect(afterFirst?.status).to.equal("SUBMITTED");
    expect(afterFirst?.txHash).to.not.be.null;
    const firstTxHash = afterFirst?.txHash;

    // Second tick - should not resubmit
    const result2 = await workerTick({
      repo,
      chain,
      now: now + 3,
      workerId: "worker-1",
      leaseMs: 60_000
    });

    const afterSecond = repo.getById(created.id);
    expect(afterSecond?.txHash).to.equal(firstTxHash); // Same hash
    expect(result2.action).to.equal("none"); // No action because receipt is null
  });

  it("returns none when no approved requests available", async function () {
    const db = await createDb();
    const repo = new PayoutRepo(db);
    const now = 1_700_000_000;

    const result = await workerTick({
      repo,
      chain: new FakeChainClient(),
      now,
      workerId: "worker-1",
      leaseMs: 60_000
    });

    expect(result.claimedId).to.be.null;
    expect(result.action).to.equal("none");
  });

  it("handles concurrent workers with lease locking", async function () {
    const db = await createDb();
    const repo = new PayoutRepo(db);
    const now = 1_700_000_000;

    const created = repo.create({
      to: "0x00000000000000000000000000000000000000a1",
      amount: "1000000",
      asset: "USDC",
      now
    });
    repo.approve(created.id, now + 1);

    // Worker 1 claims
    const result1 = await workerTick({
      repo,
      chain: new FakeChainClient(),
      now: now + 2,
      workerId: "worker-1",
      leaseMs: 60_000
    });

    expect(result1.claimedId).to.equal(created.id);

    // Worker 2 tries to claim immediately (lease still active)
    const result2 = await workerTick({
      repo,
      chain: new FakeChainClient(),
      now: now + 3,
      workerId: "worker-2",
      leaseMs: 60_000
    });

    expect(result2.claimedId).to.be.null; // Cannot claim, locked by worker-1
    expect(result2.action).to.equal("none");
  });

  it("allows reclaim after lease expires", async function () {
    const db = await createDb();
    const repo = new PayoutRepo(db);
    const now = 1_700_000_000;

    const created = repo.create({
      to: "0x00000000000000000000000000000000000000a1",
      amount: "1000000",
      asset: "USDC",
      now
    });
    repo.approve(created.id, now + 1);

    // Worker 1 claims with 1 second lease
    const claimed = repo.claimApproved(now + 2, "worker-1", 1000);
    expect(claimed).to.not.be.null;
    const lockExpires = claimed!.lockExpiresAt!;

    // Worker 2 tries before lease expires - should fail
    const claimed2 = repo.claimApproved(lockExpires - 1, "worker-2", 1000);
    expect(claimed2).to.be.null;

    // Worker 2 tries after lease expires - should succeed
    const claimed3 = repo.claimApproved(lockExpires + 1, "worker-2", 1000);
    expect(claimed3).to.not.be.null;
    expect(claimed3?.id).to.equal(created.id);
  });

  it("tracks daily total correctly across multiple payouts", async function () {
    const db = await createDb();
    const repo = new PayoutRepo(db);
    const now = 1_700_000_000;

    // Create first payout at 10M (within maxPerRequest of 25M)
    const created1 = repo.create({
      to: "0x00000000000000000000000000000000000000a1",
      amount: "10000000",
      asset: "USDC",
      now
    });
    repo.approve(created1.id, now + 1);

    // Submit first payout
    const chain1 = new FakeChainClient();
    const result1 = await workerTick({
      repo,
      chain: chain1,
      now: now + 2,
      workerId: "worker-1",
      leaseMs: 60_000
    });
    expect(result1.action).to.equal("submitted");

    // Verify daily total now includes first payout
    const dailyTotal = repo.getDailyTotal(now + 2);
    expect(dailyTotal).to.equal(10000000n);
  });

  it("handles transaction revert and marks as FAILED", async function () {
    const db = await createDb();
    const repo = new PayoutRepo(db);
    const now = 1_700_000_000;

    const created = repo.create({
      to: "0x00000000000000000000000000000000000000a1",
      amount: "1000000",
      asset: "USDC",
      now
    });
    repo.approve(created.id, now + 1);

    // Submit transaction
    const chain = new FakeChainClient();
    const result1 = await workerTick({
      repo,
      chain,
      now: now + 2,
      workerId: "worker-1",
      leaseMs: 60_000
    });
    expect(result1.action).to.equal("submitted");

    const afterSubmit = repo.getById(created.id);
    const txHash = afterSubmit?.txHash;

    // Simulate transaction revert
    chain.setRevertedTx(txHash!);

    // Continue after lease expires
    // Lease expires at: now + 2 + 60000 = now + 60002
    // So we call at now + 70000 (after lease expiration)
    const result2 = await workerTick({
      repo,
      chain,
      now: now + 70000,
      workerId: "worker-1",
      leaseMs: 60_000
    });

    expect(result2.action).to.equal("failed");
    const updated = repo.getById(created.id);
    expect(updated?.status).to.equal("FAILED");
    expect(updated?.failedReason).to.include("reverted");
  });

  it("confirms transaction after sufficient confirmations", async function () {
    const db = await createDb();
    const repo = new PayoutRepo(db);
    const now = 1_700_000_000;

    const created = repo.create({
      to: "0x00000000000000000000000000000000000000a1",
      amount: "1000000",
      asset: "USDC",
      now
    });
    repo.approve(created.id, now + 1);

    const chain = new FakeChainClient();
    const result1 = await workerTick({
      repo,
      chain,
      now: now + 2,
      workerId: "worker-1",
      leaseMs: 60_000
    });
    expect(result1.action).to.equal("submitted");

    const afterSubmit = repo.getById(created.id);
    const txHash = afterSubmit?.txHash;

    chain.setConfirmations(txHash!, 3);

    const result2 = await workerTick({
      repo,
      chain,
      now: now + 70000,
      workerId: "worker-1",
      leaseMs: 60_000
    });

    expect(result2.action).to.equal("confirmed");
    const updated = repo.getById(created.id);
    expect(updated?.status).to.equal("CONFIRMED");
    expect(updated?.confirmedAt).to.not.be.null;
  });
});
