import { NextFunction, Response } from "express";
import { AuthenticatedRequest } from "../middleware/auth.middleware.js";
import { StellarRpcAdapter } from "../adapters/stellarRpc.adapter.js";
import { AppError } from "../types/backend.types.js";

export function createEscrowController(stellarRpc: StellarRpcAdapter) {
  return {
    handlePhase2Pending(_req: AuthenticatedRequest, _res: Response, next: NextFunction) {
      next(
        new AppError(
          501,
          "PHASE_2_REQUIRED",
          "On-chain escrow execution (prepare, fund, release, refund) is scheduled for Phase 2 Trustless Work integration."
        )
      );
    },

    async handleVerifyTx(req: AuthenticatedRequest, res: Response, next: NextFunction) {
      try {
        const { hash } = req.params;
        if (!hash || !/^[a-fA-F0-9]{64}$/.test(hash)) {
          throw new AppError(400, "INVALID_TX_HASH", "A valid 64-character hex Stellar transaction hash is required.");
        }
        const result = await stellarRpc.verifyTransaction(hash);
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  };
}
