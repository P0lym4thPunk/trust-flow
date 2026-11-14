import crypto from "crypto";
import path from "path";

export interface AiRuntimeConfig {
  apiKey: string | null;
  model: string;
  timeoutMs: number;
  maxInputChars: number;
  maxOutputTokens: number;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

export interface AuthRuntimeConfig {
  googleClientId: string | null;
  privyAppId: string | null;
  privyAppSecret: string | null;
  privyVerificationKey: string | null;
  otpSecret: string;
  otpTtlMs: number;
  otpMaxAttempts: number;
  otpStartRateLimitMax: number;
  otpRateLimitWindowMs: number;
  emailOtpWebhookUrl: string | null;
  allowDevSandbox: boolean;
  sessionTtlMs: number;
}

export interface ServerRuntimeConfig {
  nodeEnv: string;
  isProd: boolean;
  dataDir: string;
  horizonUrl: string;
  ai: AiRuntimeConfig;
  auth: AuthRuntimeConfig;
}

const EPHEMERAL_DEV_OTP_SECRET = crypto.randomBytes(32).toString("hex");

function parsePositiveInt(val: string | undefined, fallback: number): number {
  if (!val) return fallback;
  const parsed = parseInt(val, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getRuntimeConfig(overrides?: { dataDir?: string; allowDevSandbox?: boolean }): ServerRuntimeConfig {
  const nodeEnv = process.env.NODE_ENV || "development";
  const isProd = nodeEnv === "production";

  const allowDevSandbox =
    overrides?.allowDevSandbox !== undefined
      ? overrides.allowDevSandbox
      : !isProd && process.env.ALLOW_DEV_SANDBOX !== "false";

  const dataDir =
    overrides?.dataDir ||
    (process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), ".data"));

  return {
    nodeEnv,
    isProd,
    dataDir,
    horizonUrl: process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org",
    ai: {
      apiKey: process.env.GEMINI_API_KEY?.trim() || null,
      // Runtime model is Gemini 3.8 Flash (never silently substituted)
      model: process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash",
      timeoutMs: parsePositiveInt(process.env.AI_TIMEOUT_MS, 6000),
      maxInputChars: parsePositiveInt(process.env.AI_MAX_INPUT_CHARS, 2000),
      maxOutputTokens: parsePositiveInt(process.env.AI_MAX_OUTPUT_TOKENS, 1024),
      rateLimitMax: parsePositiveInt(process.env.AI_RATE_LIMIT_MAX, 20),
      rateLimitWindowMs: parsePositiveInt(process.env.AI_RATE_LIMIT_WINDOW_MS, 60_000),
    },
    auth: {
      googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || null,
      privyAppId: process.env.PRIVY_APP_ID?.trim() || process.env.VITE_PRIVY_APP_ID?.trim() || null,
      privyAppSecret: process.env.PRIVY_APP_SECRET?.trim() || null,
      privyVerificationKey: process.env.PRIVY_VERIFICATION_KEY?.trim() || null,
      otpSecret: process.env.OTP_SECRET?.trim() || EPHEMERAL_DEV_OTP_SECRET,
      otpTtlMs: parsePositiveInt(process.env.OTP_TTL_MS, 10 * 60 * 1000),
      otpMaxAttempts: parsePositiveInt(process.env.OTP_MAX_ATTEMPTS, 5),
      otpStartRateLimitMax: parsePositiveInt(process.env.OTP_RATE_LIMIT_MAX, 5),
      otpRateLimitWindowMs: parsePositiveInt(process.env.OTP_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
      emailOtpWebhookUrl: process.env.EMAIL_OTP_WEBHOOK_URL?.trim() || null,
      allowDevSandbox,
      sessionTtlMs: parsePositiveInt(process.env.SESSION_TTL_MS, 30 * 24 * 60 * 60 * 1000),
    },
  };
}
