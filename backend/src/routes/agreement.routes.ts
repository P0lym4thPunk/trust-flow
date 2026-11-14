import { Router } from "express";
import { createAgreementController } from "../controllers/agreement.controller.js";
import { createAuthMiddleware } from "../middleware/auth.middleware.js";
import { AgreementService } from "../services/agreement.service.js";
import { AuthService } from "../services/auth.service.js";

export function createAgreementRoutes(agreementService: AgreementService, authService: AuthService) {
  const router = Router();
  const controller = createAgreementController(agreementService);
  const requireAuth = createAuthMiddleware(authService);

  router.use(requireAuth);

  router.get("/", controller.listAll);
  router.get("/:id", controller.getById);
  router.post("/", controller.create);

  // Explicit Phase 1 non-financial lifecycle transition endpoints
  router.post("/:id/accept", controller.accept);
  router.post("/:id/request-changes", controller.requestChanges);
  router.post("/:id/fulfil", controller.submitFulfilment);
  router.post("/:id/approve", controller.approve);
  router.post("/:id/cancel-request", controller.requestCancellation);
  router.post("/:id/cancel-withdraw", controller.withdrawCancellation);
  router.post("/:id/cancel-confirm", controller.confirmCancellation);

  // Financial transitions gated to Phase 2 Trustless Work integration
  router.post("/:id/fund", controller.blockPhase2Financial);
  router.post("/:id/release", controller.blockPhase2Financial);
  router.post("/:id/refund", controller.blockPhase2Financial);

  return router;
}
