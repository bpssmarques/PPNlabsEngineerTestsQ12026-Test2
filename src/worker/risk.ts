import riskConfig from "../../candidate-pack/risk.json";
import {PayoutRequestRow} from "../db/repo";

export interface RiskResult {
  ok: boolean;
  reason?: string;
}

export function runRiskChecks(row: PayoutRequestRow, dailyTotal: bigint): RiskResult {
  const amount = BigInt(row.amount);

  // Check denylist
  const normalizedTo = row.to.toLowerCase();
  for (const denied of riskConfig.denylist) {
    if (denied.toLowerCase() === normalizedTo) {
      return {ok: false, reason: `recipient ${row.to} is denylisted`};
    }
  }

  // Check per-request limit
  const maxPerRequest = BigInt(riskConfig.maxPerRequest);
  if (amount > maxPerRequest) {
    return {ok: false, reason: `amount ${row.amount} exceeds maxPerRequest ${riskConfig.maxPerRequest}`};
  }

  // Check daily total limit (existing daily total + this request)
  const maxDailyTotal = BigInt(riskConfig.maxDailyTotal);
  if (dailyTotal + amount > maxDailyTotal) {
    return {
      ok: false,
      reason: `daily total would be ${(dailyTotal + amount).toString()} exceeding maxDailyTotal ${riskConfig.maxDailyTotal}`,
    };
  }

  return {ok: true};
}
