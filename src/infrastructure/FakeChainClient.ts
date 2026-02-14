import {IChainClient} from "../interfaces/IChainClient";
import {TxReceipt, SubmitPayoutInput, SubmitPayoutResult} from "../types/chain.types";

export class FakeChainClient implements IChainClient {
  private receipts = new Map<string, TxReceipt>();

  async submitPayout(input: SubmitPayoutInput): Promise<SubmitPayoutResult> {
    // Generate deterministic fake txHash from requestId
    const txHash = `0x${input.requestId.slice(0, 16).padEnd(16, "0")}`;
    
    // Auto-create receipt with 0 confirmations if not already set
    if (!this.receipts.has(txHash)) {
      this.receipts.set(txHash, {
        txHash,
        confirmations: 0,
        reverted: false
      });
    }
    
    return {txHash};
  }

  async getReceipt(txHash: string): Promise<TxReceipt | null> {
    return this.receipts.get(txHash) || null;
  }

  setConfirmations(txHash: string, confirmations: number): void {
    const receipt = this.receipts.get(txHash) || {
      txHash,
      confirmations: 0,
      reverted: false
    };
    receipt.confirmations = confirmations;
    this.receipts.set(txHash, receipt);
  }

  /**
   * Test helper: Mark transaction as reverted
   */
  setRevertedTx(txHash: string): void {
    const receipt = this.receipts.get(txHash) || {
      txHash,
      confirmations: 0,
      reverted: true
    };
    receipt.reverted = true;
    this.receipts.set(txHash, receipt);
  }
}

/**
 * Mock blockchain client with configurable receipts for advanced testing
 */
export class MockChainClientWithReceipts implements IChainClient {
  private receipts = new Map<string, TxReceipt>();

  async submitPayout(input: SubmitPayoutInput): Promise<SubmitPayoutResult> {
    const txHash = `0x${input.requestId.slice(0, 16).padEnd(16, "0")}`;
    
    // Auto-create receipt with 0 confirmations
    this.receipts.set(txHash, {
      txHash,
      confirmations: 0,
      reverted: false
    });
    
    return {txHash};
  }

  async getReceipt(txHash: string): Promise<TxReceipt | null> {
    return this.receipts.get(txHash) || null;
  }

  /**
   * Test helper: Set receipt for a transaction
   */
  setReceipt(txHash: string, receipt: TxReceipt): void {
    this.receipts.set(txHash, receipt);
  }

  /**
   * Test helper: Increment confirmations for a transaction
   */
  incrementConfirmations(txHash: string): void {
    const receipt = this.receipts.get(txHash);
    if (receipt) {
      receipt.confirmations++;
    }
  }

  /**
   * Test helper: Mark transaction as reverted
   */
  markReverted(txHash: string): void {
    const receipt = this.receipts.get(txHash);
    if (receipt) {
      receipt.reverted = true;
    }
  }
}
