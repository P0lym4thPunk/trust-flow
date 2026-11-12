import { Horizon } from "@stellar/stellar-sdk";

export class StellarRpcAdapter {
  private horizonServer: Horizon.Server;

  constructor() {
    this.horizonServer = new Horizon.Server(
      process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org"
    );
  }

  /**
   * Authoritatively checks whether a transaction hash was confirmed on Stellar
   */
  async verifyTransaction(txHash: string): Promise<{
    confirmed: boolean;
    ledger?: number;
    createdAt?: string;
    successful?: boolean;
    error?: string;
  }> {
    try {
      const tx = await this.horizonServer.transactions().transaction(txHash).call();
      return {
        confirmed: true,
        ledger: tx.ledger_attr,
        createdAt: tx.created_at,
        successful: tx.successful,
      };
    } catch (err: any) {
      return {
        confirmed: false,
        error: err.message || "Transaction not found on Stellar testnet",
      };
    }
  }

  /**
   * Fetches the current balance of an account on Stellar
   */
  async getAccountBalances(address: string): Promise<{
    address: string;
    balances: Array<{ asset: string; balance: string }>;
  }> {
    try {
      const account = await this.horizonServer.loadAccount(address);
      const balances = account.balances.map((b: any) => ({
        asset: b.asset_type === "native" ? "XLM" : b.asset_code,
        balance: b.balance,
      }));
      return { address, balances };
    } catch (err: any) {
      return { address, balances: [] };
    }
  }
}

export const stellarRpcAdapter = new StellarRpcAdapter();
