import { AppError } from "../types/backend.types.js";

/**
 * Trustless Work V1 Integration Adapter (Phase 2 Integration Boundary)
 *
 * Phase 1 keeps all financial execution disabled until live Trustless Work V1
 * API credentials and on-chain Stellar verification are connected in Phase 2.
 */
export interface TrustlessWorkEscrowParams {
  title: string;
  amount: string;
  asset: "USDC" | "XLM";
  payer: string;
  recipient: string;
  approver: string;
  releaseSigner?: string;
  deadline: string;
}

export class TrustlessWorkAdapter {
  private readonly apiKey: string | null = process.env.TRUSTLESS_WORK_API_KEY || null;

  public isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async prepareEscrowCreation(_params: TrustlessWorkEscrowParams): Promise<never> {
    throw new AppError(
      501,
      "PHASE_2_REQUIRED",
      "Trustless Work V1 escrow creation is scheduled for Phase 2."
    );
  }

  async verifyEscrowState(_escrowId: string): Promise<never> {
    throw new AppError(
      501,
      "PHASE_2_REQUIRED",
      "Trustless Work V1 on-chain state verification is scheduled for Phase 2."
    );
  }
}

export const trustlessWorkAdapter = new TrustlessWorkAdapter();
