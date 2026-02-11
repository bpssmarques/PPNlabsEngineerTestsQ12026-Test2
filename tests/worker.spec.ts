import {expect} from "chai";
import {createDb} from "../src/db/db";
import {PayoutRepo} from "../src/db/repo";
import {FakeChainClient} from "../src/worker/chain";
import {workerTick} from "../src/worker/workerTick";

describe("workerTick", function () {
  it("claims an approved row and submits a transaction", async function () {
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

    const result = await workerTick({
      repo,
      chain: new FakeChainClient(),
      now: now + 2,
      workerId: "worker-1",
      leaseMs: 60_000
    });

    expect(result.action).to.equal("submitted");
  });
});
