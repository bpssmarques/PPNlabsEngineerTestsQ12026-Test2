import riskConfig from "../../candidate-pack/risk.json";
import { createDb } from "../db/db";
import { PayoutRepo } from "../db/repo";
import { createLogger } from "../shared/logger";

const logger = createLogger("seedDemoRequest");

async function main() {
  const db = await createDb();
  const repo = new PayoutRepo(db);
  const now = Math.floor(Date.now() / 1000);

  const created = repo.create({
    to: riskConfig.demo.to,
    amount: riskConfig.demo.amount,
    asset: riskConfig.demo.asset,
    now
  });

  const approved = repo.approve(created.id, now + 1);
  if (!approved) {
    throw new Error("failed-to-approve-demo-request");
  }

  process.stdout.write(`${JSON.stringify({ id: created.id, requestId: created.requestId, status: approved.status })}\n`);
}

main().catch((error) => {
  logger.error("seed-demo-request-failed", { error });
  process.exitCode = 1;
});
