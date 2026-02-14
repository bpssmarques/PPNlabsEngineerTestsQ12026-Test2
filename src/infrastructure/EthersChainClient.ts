import {ethers} from "ethers";
import {IChainClient} from "../interfaces/IChainClient";
import {TxReceipt, SubmitPayoutInput, SubmitPayoutResult} from "../types/chain.types";

export class EthersChainClient implements IChainClient {
  private readonly provider: ethers.Provider;
  private readonly vault: ethers.Contract;
  private readonly operator: ethers.Wallet;

  constructor(
    rpcUrl: string,
    vaultAddress: string,
    operatorPrivateKey: string,
    vaultAbi: ethers.InterfaceAbi
  ) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.operator = new ethers.Wallet(operatorPrivateKey, this.provider);
    this.vault = new ethers.Contract(vaultAddress, vaultAbi, this.operator);
  }

  async submitPayout(input: SubmitPayoutInput): Promise<SubmitPayoutResult> {
    const requestIdBytes32 = ethers.keccak256(ethers.toUtf8Bytes(input.requestId));

    const tx = await this.vault.payout(input.to, BigInt(input.amount), requestIdBytes32);

    return {txHash: tx.hash};
  }

  async getReceipt(txHash: string): Promise<TxReceipt | null> {
    const receipt = await this.provider.getTransactionReceipt(txHash);
    if (!receipt) {
      return null;
    }

    const currentBlock = await this.provider.getBlockNumber();
    const confirmations = currentBlock - receipt.blockNumber + 1;

    return {
      txHash,
      confirmations,
      reverted: receipt.status === 0 // 0 = reverted, 1 = success
    };
  }
}
