import { createDb } from "../db/db";
import { PayoutRepo } from "../db/repo";
import { createEthersChainClientFromEnv } from "./chain";
import { workerTick } from "./workerTick";
import { createLogger } from "../shared/logger";

const logger = createLogger("runWorkerTick");

async function main() {
  const db = await createDb();
  const repo = new PayoutRepo(db);
  const chain = createEthersChainClientFromEnv();

  const now = Math.floor(Date.now() / 1000);

  const result = await workerTick({
    repo,
    chain,
    now: now,
    workerId: process.env.WORKER_ID ?? "worker-local",
    leaseMs: Number(process.env.WORKER_LEASE_MS ?? "60000")
  });

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  logger.error("worker-tick-process-failed", { error });
  process.exitCode = 1;
});
