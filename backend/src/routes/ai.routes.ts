import { Router } from "express";
import { createAiController } from "../controllers/ai.controller.js";
import { createAuthMiddleware } from "../middleware/auth.middleware.js";
import { AiService } from "../services/ai.service.js";
import { AuthService } from "../services/auth.service.js";

export function createAiRoutes(aiService: AiService, authService: AuthService) {
  const router = Router();
  const controller = createAiController(aiService);
  const requireAuth = createAuthMiddleware(authService);

  router.use(requireAuth);
  router.get("/info", controller.getInfo);
  router.post("/draft", controller.handleDraft);
  router.post("/check", controller.handleCheck);

  return router;
}
