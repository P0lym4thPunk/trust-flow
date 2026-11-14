import express, { Router } from "express";
import { StellarRpcAdapter } from "./adapters/stellarRpc.adapter.js";
import { getRuntimeConfig, ServerRuntimeConfig } from "./config/runtime.config.js";
import { errorHandler } from "./middleware/auth.middleware.js";
import { AgreementRepository, FileAgreementRepository } from "./repositories/agreement.repository.js";
import { AuthRepository, FileAuthRepository } from "./repositories/auth.repository.js";
import { createAgreementRoutes } from "./routes/agreement.routes.js";
import { createAiRoutes } from "./routes/ai.routes.js";
import { createAuthRoutes } from "./routes/auth.routes.js";
import { createEscrowRoutes } from "./routes/escrow.routes.js";
import { AgreementService } from "./services/agreement.service.js";
import { AiService } from "./services/ai.service.js";
import { AuthService, OtpDeliveryProvider, WebhookOtpDeliveryProvider } from "./services/auth.service.js";
import { FetchLike, JwtVerifierService } from "./services/jwtVerifier.service.js";
import { PrivyClientService } from "./services/privyClient.service.js";

export interface CreateApiModuleOptions {
  dataDir?: string;
  allowDevSandbox?: boolean;
  config?: ServerRuntimeConfig;
  agreementRepo?: AgreementRepository;
  authRepo?: AuthRepository;
  otpDelivery?: OtpDeliveryProvider;
  fetchFn?: FetchLike;
  privyClient?: PrivyClientService;
}

export function createApiModule(options: CreateApiModuleOptions = {}) {
  const config =
    options.config ||
    getRuntimeConfig({
      dataDir: options.dataDir,
      allowDevSandbox: options.allowDevSandbox,
    });

  const fetchFn = options.fetchFn || globalThis.fetch;
  const agreementRepo = options.agreementRepo || new FileAgreementRepository(config.dataDir);
  const authRepo = options.authRepo || new FileAuthRepository(config.dataDir);

  const jwtVerifier = new JwtVerifierService(fetchFn);
  const privyClient =
    options.privyClient ||
    new PrivyClientService(fetchFn, {
      baseUrl: config.auth.privyApiBaseUrl,
      timeoutMs: config.auth.privyApiTimeoutMs,
    });
  const otpDelivery =
    options.otpDelivery || new WebhookOtpDeliveryProvider(config.auth.emailOtpWebhookUrl, fetchFn);

  const authService = new AuthService(
    authRepo,
    config.auth,
    jwtVerifier,
    otpDelivery,
    config.horizonUrl,
    fetchFn,
    privyClient
  );
  const agreementService = new AgreementService(agreementRepo);
  const aiService = new AiService(config.ai);
  const stellarRpc = new StellarRpcAdapter();

  const router = Router();
  router.use("/auth", createAuthRoutes(authService));
  router.use("/agreements", createAgreementRoutes(agreementService, authService));
  router.use("/ai", createAiRoutes(aiService, authService));
  router.use("/escrow", createEscrowRoutes(stellarRpc, authService));
  router.use(errorHandler);

  return {
    router,
    config,
    agreementRepo,
    authRepo,
    agreementService,
    authService,
    aiService,
    jwtVerifier,
  };
}

/**
 * Creates a standalone Express app wrapping the /api router for isolated HTTP testing.
 */
export function createBackendApp(options: CreateApiModuleOptions = {}) {
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  const module = createApiModule(options);
  app.use("/api", module.router);
  app.use(errorHandler);
  return { app, ...module };
}

export * from "./types/backend.types.js";
export * from "./config/runtime.config.js";
export * from "./repositories/agreement.repository.js";
export * from "./repositories/auth.repository.js";
export * from "./services/agreement.service.js";
export * from "./services/auth.service.js";
export * from "./services/ai.service.js";
export * from "./services/hash.service.js";
export * from "./services/jwtVerifier.service.js";
export * from "./services/privyClient.service.js";
export * from "./middleware/auth.middleware.js";
export * from "./adapters/trustlessWork.adapter.js";
export * from "./adapters/pollar.adapter.js";
export * from "./adapters/stellarRpc.adapter.js";
