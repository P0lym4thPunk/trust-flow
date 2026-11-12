import { Router } from "express";
import aiRoutes from "./routes/ai.routes.js";
import agreementRoutes from "./routes/agreement.routes.js";
import escrowRoutes from "./routes/escrow.routes.js";

const backendRouter = Router();

backendRouter.use("/ai", aiRoutes);
backendRouter.use("/agreements", agreementRoutes);
backendRouter.use("/escrow", escrowRoutes);

export { backendRouter };
export * from "./types/backend.types.js";
export * from "./services/agreement.service.js";
export * from "./services/ai.service.js";
export * from "./adapters/trustlessWork.adapter.js";
export * from "./adapters/pollar.adapter.js";
export * from "./adapters/stellarRpc.adapter.js";
