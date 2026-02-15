export interface TxReceipt {
  txHash: string;
  confirmations: number;
  reverted: boolean;
}

export interface SubmitPayoutInput {
  requestId: string;
  to: string;
  amount: string;
}

export interface SubmitPayoutResult {
  txHash: string;
}
