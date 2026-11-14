import { Router } from "express";
import { createAuthController } from "../controllers/auth.controller.js";
import { createAuthMiddleware } from "../middleware/auth.middleware.js";
import { AuthService } from "../services/auth.service.js";

export function createAuthRoutes(authService: AuthService) {
  const router = Router();
  const controller = createAuthController(authService);
  const requireAuth = createAuthMiddleware(authService);

  router.get("/capabilities", controller.getCapabilities);
  router.post("/otp/start", controller.startOtp);
  router.post("/otp/verify", controller.verifyOtp);
  router.post("/google", controller.googleLogin);
  router.post("/privy-sync", controller.privySync);
  router.post("/sandbox", controller.sandboxLogin);
  router.post("/wallet/link", requireAuth, controller.linkWallet);
  router.get("/me", controller.me);
  router.post("/logout", controller.logout);

  return router;
}
