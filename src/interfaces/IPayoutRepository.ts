import {
  PayoutRequest,
  PayoutStatus,
  CreatePayoutInput,
  UpdateStatusPatch,
  ListPayoutInput
} from "../types/payout.types";

export interface IPayoutRepository {
  create(input: CreatePayoutInput): PayoutRequest;

  getById(id: string): PayoutRequest | null;
  updateStatus(
    id: string,
    status: PayoutStatus,
    now: number,
    patch?: UpdateStatusPatch
  ): PayoutRequest | null;

  approve(id: string, now: number): PayoutRequest | null;
  list(input: ListPayoutInput): PayoutRequest[];
  claimApproved(now: number, owner: string, leaseMs: number): PayoutRequest | null;

  getDailyTotal(now: number): bigint;
}
