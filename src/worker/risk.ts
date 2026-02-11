import riskConfig from "../../candidate-pack/risk.json";
import {PayoutRequestRow} from "../db/repo";

export interface RiskResult {
  ok: boolean;
  reason?: string;
}

export function runRiskChecks(_row: PayoutRequestRow, _dailyTotal: bigint): RiskResult {
  void riskConfig;
  // TODO(candidate): enforce candidate-pack/risk.json policy.
  return {ok: true};
}
