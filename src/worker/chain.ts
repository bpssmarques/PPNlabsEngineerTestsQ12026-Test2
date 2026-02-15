import { createHash } from "node:crypto";
import { Contract, JsonRpcProvider, Wallet, type BytesLike } from "ethers";

export interface TxReceiptView {
  txHash: string;
  confirmations: number;
  reverted: boolean;
}

export interface ChainClient {
  submitPayout(input: { requestId: string; to: string; amount: string }): Promise<{ txHash: string }>;
  getReceipt(txHash: string): Promise<TxReceiptView | null>;
}

export interface EthersChainClientConfig {
  rpcUrl: string;
  vaultAddress: string;
  operatorPrivateKey: string;
}

const VAULT_ABI = ["function payout(address to,uint256 amount,bytes32 requestId) external"];

function normalizeRequestId(requestId: string): BytesLike {
  const prefixed = requestId.startsWith("0x") ? requestId : `0x${requestId}`;
  if (prefixed.length === 66) {
    return prefixed;
  }

  if (prefixed.length > 66) {
    throw new Error("requestId-too-long");
  }

  return `0x${prefixed.slice(2).padStart(64, "0")}`;
}

export class EthersChainClient implements ChainClient {
  private readonly provider: JsonRpcProvider;
  private readonly wallet: Wallet;
  private readonly vault: Contract;

  constructor(config: EthersChainClientConfig) {
    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.wallet = new Wallet(config.operatorPrivateKey, this.provider);
    this.vault = new Contract(config.vaultAddress, VAULT_ABI, this.wallet);
  }

  async submitPayout(input: { requestId: string; to: string; amount: string }): Promise<{ txHash: string }> {
    const tx = await this.vault.payout(input.to, BigInt(input.amount), normalizeRequestId(input.requestId));
    return { txHash: tx.hash as string };
  }

  async getReceipt(txHash: string): Promise<TxReceiptView | null> {
    const receipt = await this.provider.getTransactionReceipt(txHash);
    if (!receipt) {
      return null;
    }

    const latestBlock = await this.provider.getBlockNumber();
    if (receipt.blockNumber === null) {
      throw new Error("tx-receipt-missing-block-number");
    }
    if (latestBlock < receipt.blockNumber) {
      throw new Error(
        `tx-receipt-block-in-future: receipt.blockNumber=${receipt.blockNumber}, latestBlock=${latestBlock}`
      );
    }
    const confirmations = latestBlock - receipt.blockNumber + 1;

    return {
      txHash,
      confirmations,
      reverted: receipt.status === 0
    };
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing-env:${name}`);
  }
  return value;
}

export function createEthersChainClientFromEnv(): EthersChainClient {
  return new EthersChainClient({
    rpcUrl: requireEnv("CHAIN_RPC_URL"),
    vaultAddress: requireEnv("VAULT_ADDRESS"),
    operatorPrivateKey: requireEnv("OPERATOR_PRIVATE_KEY")
  });
}

export function computeDeterministicFakeTxHash(input: { requestId: string; to: string; amount: string }): string {
  const digest = createHash("sha256").update(`${input.requestId}:${input.to}:${input.amount}`).digest("hex");
  return `0x${digest}`;
}

/**
 * FakeChainClient is a deterministic, in-memory implementation of ChainClient.
 *
 * It now generates transaction hashes by computing a SHA-256 digest over the
 * string `${requestId}:${to}:${amount}` and returning it as a hex-encoded
 * 0x-prefixed string. This is more realistic than the previous simple
 * truncation-based approach, but it does change the txHash format.
 *
 * Any tests or code that assert on the exact txHash value should use
 * `computeDeterministicFakeTxHash(...)` to avoid duplication.
 */
export class FakeChainClient implements ChainClient {
  async submitPayout(input: { requestId: string; to: string; amount: string }): Promise<{ txHash: string }> {
    return { txHash: computeDeterministicFakeTxHash(input) };
  }

  async getReceipt(_txHash: string): Promise<TxReceiptView | null> {
    return null;
  }
}
