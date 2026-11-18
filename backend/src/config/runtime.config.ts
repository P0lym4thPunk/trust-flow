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
  privyApiBaseUrl: string;
  privyApiTimeoutMs: number;
  otpSecret: string;
  otpTtlMs: number;
  otpMaxAttempts: number;
  otpStartRateLimitMax: number;
  otpRateLimitWindowMs: number;
  emailOtpWebhookUrl: string | null;
  allowDevSandbox: boolean;
  sessionTtlMs: number;
  appOrigin: string | null;
  appOriginDomain: string | null;
  appOriginError: string | null;
  hasExplicitAppOrigin: boolean;
  trustedOrigins: string[];
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
const DEFAULT_DEV_APP_ORIGIN = "http://localhost:3000";

function parsePositiveInt(val: string | undefined, fallback: number): number {
  if (!val) return fallback;
  const parsed = parseInt(val, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseCanonicalOrigin(raw: string): { origin: string; domain: string } {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes("*")) {
    throw new Error("Origin must be a concrete URL without wildcards.");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid origin URL "${raw}".`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Origin protocol must be http or https (received "${parsed.protocol}").`);
  }
  if (!parsed.hostname) {
    throw new Error("Origin must specify a valid hostname.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Origin must not include embedded credentials.");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Origin must not include a path, query string, or hash fragment.");
  }
  return {
    origin: parsed.origin,
    domain: parsed.host.toLowerCase(),
  };
}

function resolveOriginConfig(params: {
  isProd: boolean;
  rawAppOrigin?: string;
  rawTrustedOrigins?: string;
}): {
  appOrigin: string | null;
  appOriginDomain: string | null;
  appOriginError: string | null;
  hasExplicitAppOrigin: boolean;
  trustedOrigins: string[];
} {
  const trustedOrigins: string[] = [];
  let appOriginError: string | null = null;

  if (params.rawTrustedOrigins && params.rawTrustedOrigins.trim()) {
    for (const part of params.rawTrustedOrigins.split(",")) {
      const candidate = part.trim();
      if (!candidate) continue;
      try {
        const parsed = parseCanonicalOrigin(candidate);
        if (!trustedOrigins.includes(parsed.origin)) {
          trustedOrigins.push(parsed.origin);
        }
      } catch (err) {
        appOriginError =
          err instanceof Error
            ? `Invalid TRUSTED_ORIGINS entry: ${err.message}`
            : "Invalid TRUSTED_ORIGINS configuration.";
        return {
          appOrigin: null,
          appOriginDomain: null,
          appOriginError,
          hasExplicitAppOrigin: false,
          trustedOrigins: [],
        };
      }
    }
  }

  const explicitOrigin = params.rawAppOrigin?.trim() || "";
  if (!explicitOrigin) {
    if (params.isProd) {
      if (trustedOrigins.length === 1) {
        const parsed = parseCanonicalOrigin(trustedOrigins[0]);
        return {
          appOrigin: parsed.origin,
          appOriginDomain: parsed.domain,
          appOriginError: null,
          hasExplicitAppOrigin: true,
          trustedOrigins,
        };
      }
      return {
        appOrigin: null,
        appOriginDomain: null,
        appOriginError:
          trustedOrigins.length > 1
            ? "APP_ORIGIN must be configured in production when multiple TRUSTED_ORIGINS are set."
            : "APP_ORIGIN must be configured in production for SEP-53 wallet domain verification.",
        hasExplicitAppOrigin: false,
        trustedOrigins,
      };
    }

    const devFallback = parseCanonicalOrigin(DEFAULT_DEV_APP_ORIGIN);
    if (!trustedOrigins.includes(devFallback.origin)) {
      trustedOrigins.unshift(devFallback.origin);
    }
    return {
      appOrigin: devFallback.origin,
      appOriginDomain: devFallback.domain,
      appOriginError: null,
      hasExplicitAppOrigin: false,
      trustedOrigins,
    };
  }

  try {
    const parsed = parseCanonicalOrigin(explicitOrigin);
    if (trustedOrigins.length > 0 && !trustedOrigins.includes(parsed.origin)) {
      return {
        appOrigin: null,
        appOriginDomain: null,
        appOriginError: `Configured APP_ORIGIN (${parsed.origin}) is not included in TRUSTED_ORIGINS.`,
        hasExplicitAppOrigin: true,
        trustedOrigins,
      };
    }
    if (!trustedOrigins.includes(parsed.origin)) {
      trustedOrigins.unshift(parsed.origin);
    }
    return {
      appOrigin: parsed.origin,
      appOriginDomain: parsed.domain,
      appOriginError: null,
      hasExplicitAppOrigin: true,
      trustedOrigins,
    };
  } catch (err) {
    return {
      appOrigin: null,
      appOriginDomain: null,
      appOriginError:
        err instanceof Error ? `Invalid APP_ORIGIN: ${err.message}` : "Invalid APP_ORIGIN.",
      hasExplicitAppOrigin: true,
      trustedOrigins,
    };
  }
}

export function getRuntimeConfig(overrides?: {
  dataDir?: string;
  allowDevSandbox?: boolean;
  isProd?: boolean;
  appOrigin?: string;
  trustedOrigins?: string;
}): ServerRuntimeConfig {
  const isProd =
    overrides?.isProd !== undefined ? overrides.isProd : (process.env.NODE_ENV || "development") === "production";
  const nodeEnv = isProd ? "production" : process.env.NODE_ENV || "development";

  const allowDevSandbox =
    overrides?.allowDevSandbox !== undefined
      ? overrides.allowDevSandbox
      : !isProd && process.env.ALLOW_DEV_SANDBOX !== "false";

  const dataDir =
    overrides?.dataDir ||
    (process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), ".data"));

  const originConfig = resolveOriginConfig({
    isProd,
    rawAppOrigin: overrides?.appOrigin !== undefined ? overrides.appOrigin : process.env.APP_ORIGIN,
    rawTrustedOrigins:
      overrides?.trustedOrigins !== undefined ? overrides.trustedOrigins : process.env.TRUSTED_ORIGINS,
  });

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
      privyApiBaseUrl: process.env.PRIVY_API_BASE_URL?.trim() || "https://api.privy.io",
      privyApiTimeoutMs: parsePositiveInt(process.env.PRIVY_API_TIMEOUT_MS, 8000),
      otpSecret: process.env.OTP_SECRET?.trim() || EPHEMERAL_DEV_OTP_SECRET,
      otpTtlMs: parsePositiveInt(process.env.OTP_TTL_MS, 10 * 60 * 1000),
      otpMaxAttempts: parsePositiveInt(process.env.OTP_MAX_ATTEMPTS, 5),
      otpStartRateLimitMax: parsePositiveInt(process.env.OTP_RATE_LIMIT_MAX, 5),
      otpRateLimitWindowMs: parsePositiveInt(process.env.OTP_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
      emailOtpWebhookUrl: process.env.EMAIL_OTP_WEBHOOK_URL?.trim() || null,
      allowDevSandbox,
      sessionTtlMs: parsePositiveInt(process.env.SESSION_TTL_MS, 30 * 24 * 60 * 60 * 1000),
      appOrigin: originConfig.appOrigin,
      appOriginDomain: originConfig.appOriginDomain,
      appOriginError: originConfig.appOriginError,
      hasExplicitAppOrigin: originConfig.hasExplicitAppOrigin,
      trustedOrigins: originConfig.trustedOrigins,
    },
  };
}
