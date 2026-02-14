import {RiskChecker} from "../services/RiskChecker";
import {PayoutRequest} from "../types/payout.types";
import {RiskCheckResult} from "../types/risk.types";
import riskConfig from "../../candidate-pack/risk.json";

export type RiskResult = RiskCheckResult;

export function runRiskChecks(row: PayoutRequest, dailyTotal: bigint): RiskResult {
  const checker = new RiskChecker(riskConfig);
  return checker.check(row, dailyTotal);
}
