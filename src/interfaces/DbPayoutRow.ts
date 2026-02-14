import { PayoutStatus } from "../types/payout.types";

export interface DbPayoutRow {
  id: string;
  request_id: string;
  to_address: string;
  asset: string;
  amount: string;
  status: PayoutStatus;
  risk_reason: string | null;
  tx_hash: string | null;
  submitted_at: number | null;
  confirmed_at: number | null;
  failed_reason: string | null;
  created_at: number;
  updated_at: number;
  lock_owner: string | null;
  lock_expires_at: number | null;
}