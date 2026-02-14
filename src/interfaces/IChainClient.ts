import {TxReceipt, SubmitPayoutInput, SubmitPayoutResult} from "../types/chain.types";

/**
 * Interface for blockchain interaction
 * Implementations: FakeChainClient (tests), EthersChainClient (production)
 */
export interface IChainClient {
  /**
   * Submit a payout transaction to the blockchain
   * @param input - Payout details (requestId, to, amount)
   * @returns Transaction hash
   */
  submitPayout(input: SubmitPayoutInput): Promise<SubmitPayoutResult>;

  /**
   * Get transaction receipt with confirmations
   * @param txHash - Transaction hash
   * @returns Receipt or null if not mined yet
   */
  getReceipt(txHash: string): Promise<TxReceipt | null>;
}
