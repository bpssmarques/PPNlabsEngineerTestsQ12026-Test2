export interface RiskConfig {
  seed: number;
  confirmations: number;
  maxPerRequest: string;
  maxDailyTotal: string;
  denylist: string[];
}

export interface RiskCheckResult {
  ok: boolean;
  reason?: string;
}
