import {PayoutRequest} from "../types/payout.types";
import {RiskCheckResult} from "../types/risk.types";

export interface IRiskChecker {
  check(request: PayoutRequest, dailyTotal: bigint): RiskCheckResult;
}
