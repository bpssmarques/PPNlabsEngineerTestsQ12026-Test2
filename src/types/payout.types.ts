export type PayoutStatus = "PENDING_RISK" | "APPROVED" | "REJECTED" | "SUBMITTED" | "CONFIRMED" | "FAILED";

export interface PayoutRequest {
  id: string;
  requestId: string;
  to: string;
  asset: string;
  amount: string;
  status: PayoutStatus;
  riskReason: string | null;
  txHash: string | null;
  submittedAt: number | null;
  confirmedAt: number | null;
  failedReason: string | null;
  createdAt: number;
  updatedAt: number;
  lockOwner: string | null;
  lockExpiresAt: number | null;
}

export interface CreatePayoutInput {
  to: string;
  amount: string;
  asset: string;
  now: number;
}

export interface UpdateStatusPatch {
  riskReason?: string;
  txHash?: string;
  submittedAt?: number;
  confirmedAt?: number;
  failedReason?: string;
}

export interface ListPayoutInput {
  status?: PayoutStatus;
  first: number;
  after?: string | null;
}
