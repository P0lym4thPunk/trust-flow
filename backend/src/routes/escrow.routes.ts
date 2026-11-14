import { Router } from "express";
import { StellarRpcAdapter } from "../adapters/stellarRpc.adapter.js";
import { createEscrowController } from "../controllers/escrow.controller.js";
import { createAuthMiddleware } from "../middleware/auth.middleware.js";
import { AuthService } from "../services/auth.service.js";

export function createEscrowRoutes(stellarRpc: StellarRpcAdapter, authService: AuthService) {
  const router = Router();
  const controller = createEscrowController(stellarRpc);
  const requireAuth = createAuthMiddleware(authService);

  router.use(requireAuth);
  router.post("/prepare", controller.handlePhase2Pending);
  router.post("/:id/fund", controller.handlePhase2Pending);
  router.post("/:id/fulfil", controller.handlePhase2Pending);
  router.post("/:id/release", controller.handlePhase2Pending);
  router.get("/tx/:hash/verify", controller.handleVerifyTx);

  return router;
}
