import {ChainClient} from "./chain";
import {PayoutRepo} from "../db/repo";

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

export async function workerTick(_ctx: WorkerContext): Promise<WorkerResult> {
  // TODO(candidate): implement lock claim, risk checks, tx submit and confirmation handling.
  return {claimedId: null, action: "none"};
}
