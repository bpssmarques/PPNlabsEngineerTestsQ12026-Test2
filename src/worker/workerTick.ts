import {IChainClient} from "../interfaces/IChainClient";
import {IPayoutRepository} from "../interfaces/IPayoutRepository";
import {PayoutWorker} from "../services/PayoutWorker";
import {RiskChecker} from "../services/RiskChecker";
import {WorkerContext, WorkerResult} from "../types/worker.types";
import riskConfig from "../../candidate-pack/risk.json";

export interface LegacyWorkerContext {
  repo: IPayoutRepository;
  chain: IChainClient;
  now: number;
  workerId: string;
  leaseMs: number;
}

export async function workerTick(ctx: LegacyWorkerContext): Promise<WorkerResult> {
  const riskChecker = new RiskChecker(riskConfig);
  const worker = new PayoutWorker(ctx.repo, ctx.chain, riskChecker, riskConfig);
  
  return worker.tick({
    now: ctx.now,
    workerId: ctx.workerId,
    leaseMs: ctx.leaseMs
  });
}
