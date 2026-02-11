export interface TxReceiptView {
  txHash: string;
  confirmations: number;
  reverted: boolean;
}

export interface ChainClient {
  submitPayout(input: {requestId: string; to: string; amount: string}): Promise<{txHash: string}>;
  getReceipt(txHash: string): Promise<TxReceiptView | null>;
}

export class FakeChainClient implements ChainClient {
  async submitPayout(input: {requestId: string; to: string; amount: string}): Promise<{txHash: string}> {
    return {txHash: `0x${input.requestId.slice(0, 16).padEnd(16, "0")}`};
  }

  async getReceipt(_txHash: string): Promise<TxReceiptView | null> {
    return null;
  }
}
