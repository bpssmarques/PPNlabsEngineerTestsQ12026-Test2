import { expect } from "chai";
import { createDb } from "../../src/db/db";
import { PayoutRepo } from "../../src/db/repo";

describe("PayoutRepo edge scenarios", function () {
  it("blocks invalid direct transition from PENDING_RISK to SUBMITTED", async function () {
    const db = await createDb();
    const repo = new PayoutRepo(db);
    const now = 1_700_000_000;

    const created = repo.create({
      to: "0x00000000000000000000000000000000000000a1",
      amount: "100",
      asset: "USDC",
      now
    });

    const updated = repo.updateStatus(created.id, "SUBMITTED", now + 1, {
      txHash: "0xdeadbeef",
      submittedAt: now + 1
    });

    expect(updated).to.equal(null);
    expect(repo.getById(created.id)?.status).to.equal("PENDING_RISK");
  });

  it("claims exactly one APPROVED request per call", async function () {
    const db = await createDb();
    const repo = new PayoutRepo(db);
    const now = 1_700_000_000;

    const first = repo.create({
      to: "0x00000000000000000000000000000000000000a1",
      amount: "100",
      asset: "USDC",
      now
    });
    const second = repo.create({
      to: "0x00000000000000000000000000000000000000a2",
      amount: "100",
      asset: "USDC",
      now: now + 1
    });
    repo.approve(first.id, now + 2);
    repo.approve(second.id, now + 2);

    const claim1 = repo.claimApproved(now + 3, "worker-a", 60_000);
    const claim2 = repo.claimApproved(now + 3, "worker-b", 60_000);

    expect(claim1?.id).to.equal(first.id);
    expect(claim2?.id).to.equal(second.id);
  });
});
