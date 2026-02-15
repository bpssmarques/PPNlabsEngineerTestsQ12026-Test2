import riskConfig from "../../candidate-pack/risk.json";
import { PayoutRequestRow } from "../db/repo";

export interface RiskResult {
  ok: boolean;
  reason?: string;
}

const MAX_PER_REQUEST = BigInt(riskConfig.maxPerRequest);
const MAX_DAILY_TOTAL = BigInt(riskConfig.maxDailyTotal);
const DENYLIST = new Set(riskConfig.denylist.map((address) => address.toLowerCase()));

export function runRiskChecks(row: PayoutRequestRow, dailyTotal: bigint): RiskResult {
  const amount = BigInt(row.amount);

  if (amount > MAX_PER_REQUEST) {
    return { ok: false, reason: "maxPerRequest exceeded" };
  }

  if (DENYLIST.has(row.to.toLowerCase())) {
    return { ok: false, reason: "recipient is denylisted" };
  }

  if (dailyTotal + amount > MAX_DAILY_TOTAL) {
    return { ok: false, reason: "maxDailyTotal exceeded" };
  }

  return { ok: true };
}
