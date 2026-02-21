import riskConfig from "../../candidate-pack/risk.json";
import type {PayoutRequestRow} from "../db/repo";

export interface RiskResult {
  ok: boolean;
  reason?: string;
}

interface RiskConfig {
  maxPerRequest: string;
  maxDailyTotal: string;
  denylist: string[];
}

const config = riskConfig as RiskConfig;

export function runRiskChecks(row: PayoutRequestRow, dailyTotal: bigint): RiskResult {
  const maxPerRequest = BigInt(config.maxPerRequest);
  const amount = BigInt(row.amount);
  if (amount > maxPerRequest) {
    return {ok: false, reason: `amount ${row.amount} exceeds maxPerRequest ${config.maxPerRequest}`};
  }

  const maxDailyTotal = BigInt(config.maxDailyTotal);
  if (dailyTotal + amount > maxDailyTotal) {
    return {ok: false, reason: `daily total would exceed maxDailyTotal ${config.maxDailyTotal}`};
  }

  const toLower = row.to.toLowerCase();
  const denylist = (config.denylist ?? []).map((a: string) => a.toLowerCase());
  if (denylist.includes(toLower)) {
    return {ok: false, reason: `address ${row.to} is denylisted`};
  }

  return {ok: true};
}
