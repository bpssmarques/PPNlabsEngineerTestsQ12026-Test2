export interface WorkerContext {
  workerId: string;
  now: number;
  leaseMs: number;
}

export interface WorkerResult {
  claimedId: string | null;
  action: "none" | "rejected" | "submitted" | "confirmed" | "failed";
}
