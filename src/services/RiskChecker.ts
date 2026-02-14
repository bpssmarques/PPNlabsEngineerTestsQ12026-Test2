import {IRiskChecker} from "../interfaces/IRiskChecker";
import {PayoutRequest} from "../types/payout.types";
import {RiskCheckResult, RiskConfig} from "../types/risk.types";

/**
 * Production risk checker with configurable policies
 */
export class RiskChecker implements IRiskChecker {
  constructor(private readonly config: RiskConfig) {}

  check(request: PayoutRequest, dailyTotal: bigint): RiskCheckResult {
    const amount = BigInt(request.amount);
    const maxPerRequest = BigInt(this.config.maxPerRequest);
    const maxDailyTotal = BigInt(this.config.maxDailyTotal);

    console.log(`[Risk] Checking ${request.id}: amount=${amount}, dailyTotal=${dailyTotal}, to=${request.to}`);

    // Check 1: Max per request
    if (amount > maxPerRequest) {
      console.log(`[Risk] FAIL: amount ${amount} > maxPerRequest ${maxPerRequest}`);
      return {
        ok: false,
        reason: `Amount ${amount} exceeds maxPerRequest ${maxPerRequest}`
      };
    }

    // Check 2: Max daily total
    if (dailyTotal + amount > maxDailyTotal) {
      console.log(`[Risk] FAIL: dailyTotal+amount ${dailyTotal + amount} > maxDailyTotal ${maxDailyTotal}`);
      return {
        ok: false,
        reason: `Daily total ${dailyTotal + amount} exceeds maxDailyTotal ${maxDailyTotal}`
      };
    }

    // Check 3: Denylist
    const normalizedTo = request.to.toLowerCase();
    const denylist = this.config.denylist.map((addr) => addr.toLowerCase());
    if (denylist.includes(normalizedTo)) {
      console.log(`[Risk] FAIL: address ${request.to} in denylist`);
      return {
        ok: false,
        reason: `Address ${request.to} is in denylist`
      };
    }

    console.log(`[Risk] PASS`);
    return {ok: true};
  }
}
