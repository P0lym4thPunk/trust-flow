import { StrKey } from "@stellar/stellar-sdk";
import { AppError } from "../types/backend.types.js";
import { FetchLike } from "./jwtVerifier.service.js";

export interface PrivyVerifiedIdentity {
  privySub: string;
  stellarAddress: string;
  email: string | null;
  displayName: string | null;
}

export interface PrivyLookupParams {
  privySub: string;
  appId: string;
  appSecret: string;
  baseUrl?: string;
  timeoutMs?: number;
}

const DEFAULT_PRIVY_API_BASE_URL = "https://api.privy.io";
const DEFAULT_PRIVY_TIMEOUT_MS = 8000;

const OAUTH_EMAIL_ACCOUNT_TYPES = new Set([
  "google_oauth",
  "apple_oauth",
  "github_oauth",
  "discord_oauth",
  "linkedin_oauth",
  "spotify_oauth",
  "line_oauth",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidStellarAddress(addr: unknown): addr is string {
  if (typeof addr !== "string" || !addr.startsWith("G") || addr.length !== 56) {
    return false;
  }
  try {
    return StrKey.isValidEd25519PublicKey(addr);
  } catch {
    return false;
  }
}

function isVerifiedTimestamp(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isValidEmailString(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function encodePrivyUserIdPathSegment(privySub: string): string {
  const trimmed = privySub.trim();
  if (
    !trimmed ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("?") ||
    trimmed.includes("#")
  ) {
    throw new AppError(401, "INVALID_SUBJECT", "Privy token contains an invalid subject identifier.");
  }
  return trimmed.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@]+/g, encodeURIComponent);
}

function extractVerifiedEmail(linkedAccounts: Record<string, unknown>[]): string | null {
  for (const account of linkedAccounts) {
    if (
      account.type === "email" &&
      isVerifiedTimestamp(account.verified_at) &&
      isValidEmailString(account.address)
    ) {
      return account.address.trim().toLowerCase();
    }
  }

  for (const account of linkedAccounts) {
    const accountType = typeof account.type === "string" ? account.type : "";
    if (
      (OAUTH_EMAIL_ACCOUNT_TYPES.has(accountType) || accountType.startsWith("custom:")) &&
      isVerifiedTimestamp(account.verified_at) &&
      isValidEmailString(account.email)
    ) {
      return account.email.trim().toLowerCase();
    }
  }

  return null;
}

function extractAuthoritativeDisplayName(linkedAccounts: Record<string, unknown>[]): string | null {
  for (const account of linkedAccounts) {
    if (!isVerifiedTimestamp(account.verified_at)) {
      continue;
    }

    if (typeof account.name === "string" && account.name.trim().length > 0) {
      return account.name.trim();
    }

    if (typeof account.display_name === "string" && account.display_name.trim().length > 0) {
      return account.display_name.trim();
    }

    if (account.type === "telegram") {
      const first = typeof account.first_name === "string" ? account.first_name.trim() : "";
      const last = typeof account.last_name === "string" ? account.last_name.trim() : "";
      const combined = [first, last].filter(Boolean).join(" ").trim();
      if (combined.length > 0) {
        return combined;
      }
    }
  }

  return null;
}

/**
 * Validates a raw Privy REST API User JSON payload and extracts the verified
 * embedded Stellar wallet, verified email, and authoritative display name.
 */
export function extractVerifiedPrivyIdentity(
  rawUser: unknown,
  expectedSub: string
): PrivyVerifiedIdentity {
  if (!isPlainObject(rawUser)) {
    throw new AppError(502, "PRIVY_RESPONSE_INVALID", "Privy user lookup returned an invalid payload.");
  }

  if (typeof rawUser.id !== "string" || rawUser.id.trim().length === 0) {
    throw new AppError(502, "PRIVY_RESPONSE_INVALID", "Privy user payload is missing user id.");
  }

  if (rawUser.id !== expectedSub) {
    throw new AppError(
      502,
      "PRIVY_IDENTITY_MISMATCH",
      "Privy user lookup returned an identity that does not match the verified token subject."
    );
  }

  if (typeof rawUser.frozen_at === "number" && Number.isFinite(rawUser.frozen_at) && rawUser.frozen_at > 0) {
    throw new AppError(403, "PRIVY_USER_FROZEN", "This Privy account is frozen.");
  }

  if (!Array.isArray(rawUser.linked_accounts)) {
    throw new AppError(
      502,
      "PRIVY_RESPONSE_INVALID",
      "Privy user payload is missing linked_accounts."
    );
  }

  const linkedAccounts: Record<string, unknown>[] = [];
  for (const item of rawUser.linked_accounts) {
    if (!isPlainObject(item) || typeof item.type !== "string" || item.type.trim().length === 0) {
      throw new AppError(
        502,
        "PRIVY_RESPONSE_INVALID",
        "Privy user payload contains a malformed linked_accounts entry."
      );
    }
    linkedAccounts.push(item);
  }

  const embeddedStellarAddresses: string[] = [];
  let sawExternalStellarWallet = false;

  for (const account of linkedAccounts) {
    if (account.type !== "wallet") {
      continue;
    }

    if (typeof account.chain_type !== "string" || account.chain_type.trim().length === 0) {
      throw new AppError(
        502,
        "PRIVY_RESPONSE_INVALID",
        "Privy wallet linked account is missing chain_type."
      );
    }

    if (account.chain_type !== "stellar") {
      continue;
    }

    if (typeof account.address !== "string" || account.address.trim().length === 0) {
      throw new AppError(
        502,
        "INVALID_PRIVY_WALLET",
        "Privy Stellar wallet record is missing an address."
      );
    }

    const address = account.address.trim();
    const claimsPrivyClient = account.wallet_client_type === "privy" || account.wallet_client === "privy";
    const claimsEmbeddedConnector = account.connector_type === "embedded";

    if (!claimsPrivyClient && !claimsEmbeddedConnector) {
      sawExternalStellarWallet = true;
      continue;
    }

    const isStrictlyEmbeddedPrivyWallet =
      account.wallet_client_type === "privy" &&
      account.connector_type === "embedded" &&
      (account.wallet_client === undefined || account.wallet_client === "privy");

    if (!isStrictlyEmbeddedPrivyWallet) {
      throw new AppError(
        502,
        "INVALID_PRIVY_WALLET",
        "Privy Stellar wallet record has inconsistent or incomplete embedded-wallet metadata."
      );
    }

    if (
      "verified_at" in account &&
      account.verified_at !== undefined &&
      !isVerifiedTimestamp(account.verified_at)
    ) {
      throw new AppError(
        502,
        "INVALID_PRIVY_WALLET",
        "Privy embedded Stellar wallet has an unverified or invalid verification timestamp."
      );
    }

    if (!isValidStellarAddress(address)) {
      throw new AppError(
        400,
        "INVALID_STELLAR_ADDRESS",
        "Privy embedded Stellar wallet address failed Stellar StrKey validation."
      );
    }

    embeddedStellarAddresses.push(address);
  }

  if (embeddedStellarAddresses.length === 0) {
    throw new AppError(
      403,
      "NO_EMBEDDED_STELLAR_WALLET",
      sawExternalStellarWallet
        ? "Privy account has only an external Stellar wallet; an embedded Privy Stellar wallet is required."
        : "Privy account does not have a linked embedded Stellar wallet."
    );
  }

  if (embeddedStellarAddresses.length > 1) {
    throw new AppError(
      409,
      "MULTIPLE_EMBEDDED_STELLAR_WALLETS",
      "Multiple embedded Stellar wallets are linked to this Privy account. Explicit resolution is required."
    );
  }

  return {
    privySub: rawUser.id,
    stellarAddress: embeddedStellarAddresses[0],
    email: extractVerifiedEmail(linkedAccounts),
    displayName: extractAuthoritativeDisplayName(linkedAccounts),
  };
}

export class PrivyClientService {
  private readonly defaultBaseUrl: string;
  private readonly defaultTimeoutMs: number;

  constructor(
    private readonly fetchFn: FetchLike = globalThis.fetch,
    options?: { baseUrl?: string; timeoutMs?: number }
  ) {
    this.defaultBaseUrl = (options?.baseUrl || DEFAULT_PRIVY_API_BASE_URL).replace(/\/+$/, "");
    this.defaultTimeoutMs =
      options?.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_PRIVY_TIMEOUT_MS;
  }

  public async getVerifiedUserIdentity(params: PrivyLookupParams): Promise<PrivyVerifiedIdentity> {
    if (!params.appId || !params.appId.trim()) {
      throw new AppError(
        503,
        "PRIVY_AUTH_UNAVAILABLE",
        "Privy authentication is not configured on this server (missing PRIVY_APP_ID)."
      );
    }

    if (!params.appSecret || !params.appSecret.trim()) {
      throw new AppError(
        503,
        "PRIVY_CREDENTIALS_MISSING",
        "Privy server verification credentials are not configured (missing PRIVY_APP_SECRET)."
      );
    }

    const appId = params.appId.trim();
    const appSecret = params.appSecret.trim();
    const encodedSub = encodePrivyUserIdPathSegment(params.privySub);
    const baseUrl = (params.baseUrl || this.defaultBaseUrl).replace(/\/+$/, "");
    const timeoutMs =
      params.timeoutMs && params.timeoutMs > 0 ? params.timeoutMs : this.defaultTimeoutMs;
    const url = `${baseUrl}/v1/users/${encodedSub}`;

    const basicCredentials = Buffer.from(`${appId}:${appSecret}`, "utf8").toString("base64");
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new AppError(504, "PRIVY_API_TIMEOUT", "Privy user verification request timed out."));
      }, timeoutMs);
    });

    let res: Response;
    try {
      res = await Promise.race([
        this.fetchFn(url, {
          method: "GET",
          headers: {
            Authorization: `Basic ${basicCredentials}`,
            "privy-app-id": appId,
            Accept: "application/json",
          },
          signal: controller.signal,
        }),
        timeoutPromise,
      ]);
    } catch (err: unknown) {
      if (err instanceof AppError) {
        console.warn("[TrustFlow Privy] User lookup timed out", {
          privySubSuffix: params.privySub.slice(-6),
        });
        throw err;
      }
      const isAbort =
        err instanceof Error && (err.name === "AbortError" || err.message.toLowerCase().includes("abort"));
      if (isAbort) {
        console.warn("[TrustFlow Privy] User lookup timed out", {
          privySubSuffix: params.privySub.slice(-6),
        });
        throw new AppError(504, "PRIVY_API_TIMEOUT", "Privy user verification request timed out.");
      }
      console.warn("[TrustFlow Privy] User lookup network failure", {
        privySubSuffix: params.privySub.slice(-6),
      });
      throw new AppError(502, "PRIVY_API_UNAVAILABLE", "Unable to reach Privy verification service.");
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (!res.ok) {
      console.warn("[TrustFlow Privy] User lookup rejected by Privy API", {
        status: res.status,
        privySubSuffix: params.privySub.slice(-6),
      });
      if (res.status === 401 || res.status === 403) {
        throw new AppError(
          502,
          "PRIVY_API_AUTH_FAILED",
          "Privy server API authentication failed."
        );
      }
      if (res.status === 404) {
        throw new AppError(404, "PRIVY_USER_NOT_FOUND", "Authenticated Privy user was not found.");
      }
      if (res.status === 429) {
        throw new AppError(
          503,
          "PRIVY_API_RATE_LIMITED",
          "Privy verification service is temporarily rate limited."
        );
      }
      throw new AppError(502, "PRIVY_LOOKUP_FAILED", "Privy identity lookup failed.");
    }

    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      throw new AppError(
        502,
        "PRIVY_RESPONSE_INVALID",
        "Received invalid JSON from Privy verification service."
      );
    }

    return extractVerifiedPrivyIdentity(payload, params.privySub);
  }
}
