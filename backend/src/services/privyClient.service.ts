import { StrKey } from "@stellar/stellar-sdk";
import { AppError } from "../types/backend.types.js";
import { FetchLike } from "./jwtVerifier.service.js";

export interface PrivyVerifiedIdentity {
  privySub: string;
  stellarAddress: string;
  walletId?: string | null;
  email: string | null;
  displayName: string | null;
}

export interface PrivyEmbeddedWalletInfo {
  address: string;
  walletId: string | null;
}

export interface PrivyInspectedUser {
  privySub: string;
  email: string | null;
  displayName: string | null;
  embeddedWallets: PrivyEmbeddedWalletInfo[];
  sawExternalStellarWallet: boolean;
}

export interface PrivyServerWalletRecord {
  id: string;
  address: string;
  chainType: "stellar";
  ownerId: string | null;
  externalId: string | null;
  createdAt: number | null;
}

export interface PrivyLookupParams {
  privySub: string;
  appId: string;
  appSecret: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface PrivyCreateWalletParams extends PrivyLookupParams {
  idempotencyKey: string;
  externalId?: string;
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
 * Validates a raw Privy REST API User JSON payload and extracts profile fields
 * along with all valid embedded Stellar wallets (deduplicated by address).
 */
export function inspectVerifiedPrivyUser(
  rawUser: unknown,
  expectedSub: string
): PrivyInspectedUser {
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

  const embeddedWallets: PrivyEmbeddedWalletInfo[] = [];
  const seenAddresses = new Set<string>();
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

    // Reject imported or archived embedded Stellar wallet entries
    const isImportedLinkedAccount =
      account.imported === true ||
      (account.imported_at !== undefined && account.imported_at !== null);
    const isArchivedLinkedAccount =
      account.archived === true ||
      (account.archived_at !== undefined && account.archived_at !== null);

    if (isImportedLinkedAccount || isArchivedLinkedAccount) {
      sawExternalStellarWallet = true;
      continue;
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

    const walletId = typeof account.id === "string" && account.id.trim().length > 0
      ? account.id.trim()
      : null;

    if (!seenAddresses.has(address)) {
      seenAddresses.add(address);
      embeddedWallets.push({ address, walletId });
    }
  }

  return {
    privySub: rawUser.id,
    email: extractVerifiedEmail(linkedAccounts),
    displayName: extractAuthoritativeDisplayName(linkedAccounts),
    embeddedWallets,
    sawExternalStellarWallet,
  };
}

/**
 * Validates a raw Privy REST API User JSON payload and extracts the single verified
 * embedded Stellar wallet, verified email, and authoritative display name.
 */
export function extractVerifiedPrivyIdentity(
  rawUser: unknown,
  expectedSub: string
): PrivyVerifiedIdentity {
  const inspected = inspectVerifiedPrivyUser(rawUser, expectedSub);

  if (inspected.embeddedWallets.length === 0) {
    throw new AppError(
      403,
      "NO_EMBEDDED_STELLAR_WALLET",
      inspected.sawExternalStellarWallet
        ? "Privy account has only an external Stellar wallet; an embedded Privy Stellar wallet is required."
        : "Privy account does not have a linked embedded Stellar wallet."
    );
  }

  if (inspected.embeddedWallets.length > 1) {
    throw new AppError(
      409,
      "MULTIPLE_EMBEDDED_STELLAR_WALLETS",
      "Multiple embedded Stellar wallets are linked to this Privy account. Explicit resolution is required."
    );
  }

  return {
    privySub: inspected.privySub,
    stellarAddress: inspected.embeddedWallets[0].address,
    walletId: inspected.embeddedWallets[0].walletId,
    email: inspected.email,
    displayName: inspected.displayName,
  };
}

export function isPrivyServerWalletImportedOrArchived(raw: Record<string, unknown>): boolean {
  if (raw.imported === true) return true;
  if (raw.imported_at !== undefined && raw.imported_at !== null) return true;
  if (raw.archived === true) return true;
  if (raw.archived_at !== undefined && raw.archived_at !== null) return true;
  return false;
}

export function parsePrivyServerWallet(
  raw: unknown,
  expectedOwnerSub?: string
): PrivyServerWalletRecord {
  if (!isPlainObject(raw)) {
    throw new AppError(502, "PRIVY_RESPONSE_INVALID", "Privy wallet payload is not an object.");
  }
  if (typeof raw.id !== "string" || !raw.id.trim()) {
    throw new AppError(502, "PRIVY_RESPONSE_INVALID", "Privy wallet payload is missing wallet id.");
  }
  if (raw.chain_type !== "stellar") {
    throw new AppError(502, "INVALID_PRIVY_WALLET", "Privy wallet payload has unexpected chain_type.");
  }
  if (
    (raw.wallet_client_type !== undefined && raw.wallet_client_type !== "privy") ||
    (raw.wallet_client !== undefined && raw.wallet_client !== "privy") ||
    (raw.connector_type !== undefined && raw.connector_type !== "embedded")
  ) {
    throw new AppError(
      502,
      "INVALID_PRIVY_WALLET",
      "Privy wallet payload does not match embedded Privy wallet metadata."
    );
  }
  if (raw.imported === true || (raw.imported_at !== undefined && raw.imported_at !== null)) {
    throw new AppError(
      403,
      "PRIVY_WALLET_IMPORTED",
      "Imported wallets cannot be used as TrustFlow's Privy embedded primary wallet."
    );
  }
  if (raw.archived === true || (raw.archived_at !== undefined && raw.archived_at !== null)) {
    throw new AppError(
      403,
      "PRIVY_WALLET_ARCHIVED",
      "Archived wallets cannot be used as TrustFlow's Privy embedded primary wallet."
    );
  }
  if (typeof raw.address !== "string" || !isValidStellarAddress(raw.address.trim())) {
    throw new AppError(
      502,
      "INVALID_PRIVY_WALLET",
      "Privy wallet payload contains an invalid Stellar address."
    );
  }

  const rawOwnerId = typeof raw.owner_id === "string" && raw.owner_id.trim() ? raw.owner_id.trim() : null;
  const rawEntity = isPlainObject(raw.entity) ? raw.entity : null;
  const entityUserId =
    rawEntity && rawEntity.type === "user" && typeof rawEntity.id === "string" && rawEntity.id.trim()
      ? rawEntity.id.trim()
      : null;

  if (expectedOwnerSub) {
    if (rawOwnerId) {
      if (rawOwnerId !== expectedOwnerSub) {
        throw new AppError(
          502,
          "PRIVY_WALLET_OWNERSHIP_MISMATCH",
          "Privy wallet owner_id does not match the authenticated Privy user."
        );
      }
    } else if (entityUserId) {
      if (entityUserId !== expectedOwnerSub) {
        throw new AppError(
          502,
          "PRIVY_WALLET_OWNERSHIP_MISMATCH",
          "Privy wallet entity owner does not match the authenticated Privy user."
        );
      }
    } else {
      throw new AppError(
        502,
        "PRIVY_WALLET_OWNERSHIP_UNESTABLISHED",
        "Privy wallet ownership could not be verified against the authenticated Privy user."
      );
    }
  }

  return {
    id: raw.id.trim(),
    address: raw.address.trim(),
    chainType: "stellar",
    ownerId: rawOwnerId ?? entityUserId,
    externalId:
      typeof raw.external_id === "string" && raw.external_id.trim() ? raw.external_id.trim() : null,
    createdAt:
      typeof raw.created_at === "number" && Number.isFinite(raw.created_at) ? raw.created_at : null,
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

  private assertCredentials(params: { appId: string; appSecret: string }): {
    appId: string;
    appSecret: string;
    basicCredentials: string;
  } {
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
        "Privy server verification credentials are not configured on this server (missing PRIVY_APP_SECRET)."
      );
    }
    const appId = params.appId.trim();
    const appSecret = params.appSecret.trim();
    const basicCredentials = Buffer.from(`${appId}:${appSecret}`, "utf8").toString("base64");
    return { appId, appSecret, basicCredentials };
  }

  private async requestWithTimeout(
    url: string,
    init: RequestInit,
    options: { timeoutMs?: number; contextLabel: string; timeoutCode: string; timeoutMessage: string; privySub: string }
  ): Promise<Response> {
    const timeoutMs =
      options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : this.defaultTimeoutMs;
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new AppError(504, options.timeoutCode, options.timeoutMessage));
      }, timeoutMs);
    });

    try {
      return await Promise.race([
        this.fetchFn(url, { ...init, signal: controller.signal }),
        timeoutPromise,
      ]);
    } catch (err: unknown) {
      if (err instanceof AppError) {
        console.warn(`[TrustFlow Privy] ${options.contextLabel} timed out`, {
          privySubSuffix: options.privySub.slice(-6),
        });
        throw err;
      }
      const isAbort =
        err instanceof Error && (err.name === "AbortError" || err.message.toLowerCase().includes("abort"));
      if (isAbort) {
        console.warn(`[TrustFlow Privy] ${options.contextLabel} timed out`, {
          privySubSuffix: options.privySub.slice(-6),
        });
        throw new AppError(504, options.timeoutCode, options.timeoutMessage);
      }
      console.warn(`[TrustFlow Privy] ${options.contextLabel} network failure`, {
        privySubSuffix: options.privySub.slice(-6),
      });
      throw new AppError(502, "PRIVY_API_UNAVAILABLE", "Unable to reach Privy verification service.");
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  public async getUser(params: PrivyLookupParams): Promise<PrivyInspectedUser> {
    const { appId, basicCredentials } = this.assertCredentials(params);
    const encodedSub = encodePrivyUserIdPathSegment(params.privySub);
    const baseUrl = (params.baseUrl || this.defaultBaseUrl).replace(/\/+$/, "");
    const url = `${baseUrl}/v1/users/${encodedSub}`;

    const res = await this.requestWithTimeout(
      url,
      {
        method: "GET",
        headers: {
          Authorization: `Basic ${basicCredentials}`,
          "privy-app-id": appId,
          Accept: "application/json",
        },
      },
      {
        timeoutMs: params.timeoutMs,
        contextLabel: "User lookup",
        timeoutCode: "PRIVY_API_TIMEOUT",
        timeoutMessage: "Privy user verification request timed out.",
        privySub: params.privySub,
      }
    );

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

    return inspectVerifiedPrivyUser(payload, params.privySub);
  }

  public async getVerifiedUserIdentity(params: PrivyLookupParams): Promise<PrivyVerifiedIdentity> {
    const inspected = await this.getUser(params);
    if (inspected.embeddedWallets.length === 0) {
      throw new AppError(
        403,
        "NO_EMBEDDED_STELLAR_WALLET",
        inspected.sawExternalStellarWallet
          ? "Privy account has only an external Stellar wallet; an embedded Privy Stellar wallet is required."
          : "Privy account does not have a linked embedded Stellar wallet."
      );
    }
    if (inspected.embeddedWallets.length > 1) {
      throw new AppError(
        409,
        "MULTIPLE_EMBEDDED_STELLAR_WALLETS",
        "Multiple embedded Stellar wallets are linked to this Privy account. Explicit resolution is required."
      );
    }
    return {
      privySub: inspected.privySub,
      stellarAddress: inspected.embeddedWallets[0].address,
      walletId: inspected.embeddedWallets[0].walletId,
      email: inspected.email,
      displayName: inspected.displayName,
    };
  }

  public async listUserStellarWallets(params: PrivyLookupParams): Promise<PrivyServerWalletRecord[]> {
    const { appId, basicCredentials } = this.assertCredentials(params);
    const baseUrl = (params.baseUrl || this.defaultBaseUrl).replace(/\/+$/, "");
    const results: PrivyServerWalletRecord[] = [];
    const seenIds = new Set<string>();

    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const qs = new URLSearchParams({
        user_id: params.privySub,
        chain_type: "stellar",
      });
      if (cursor) qs.set("cursor", cursor);
      const url = `${baseUrl}/v1/wallets?${qs.toString()}`;

      const res = await this.requestWithTimeout(
        url,
        {
          method: "GET",
          headers: {
            Authorization: `Basic ${basicCredentials}`,
            "privy-app-id": appId,
            Accept: "application/json",
          },
        },
        {
          timeoutMs: params.timeoutMs,
          contextLabel: "Wallet list",
          timeoutCode: "PRIVY_API_TIMEOUT",
          timeoutMessage: "Privy wallet lookup request timed out.",
          privySub: params.privySub,
        }
      );

      if (!res.ok) {
        console.warn("[TrustFlow Privy] Wallet list rejected by Privy API", {
          status: res.status,
          privySubSuffix: params.privySub.slice(-6),
        });
        if (res.status === 401 || res.status === 403) {
          throw new AppError(502, "PRIVY_API_AUTH_FAILED", "Privy server API authentication failed.");
        }
        if (res.status === 429) {
          throw new AppError(503, "PRIVY_API_RATE_LIMITED", "Privy wallet service is temporarily rate limited.");
        }
        throw new AppError(502, "PRIVY_WALLET_LOOKUP_FAILED", "Privy wallet lookup failed.");
      }

      let payload: unknown;
      try {
        payload = await res.json();
      } catch {
        throw new AppError(502, "PRIVY_RESPONSE_INVALID", "Received invalid JSON from Privy wallet service.");
      }

      if (!isPlainObject(payload) || !Array.isArray(payload.data)) {
        throw new AppError(502, "PRIVY_RESPONSE_INVALID", "Privy wallet list response is missing data array.");
      }

      for (const item of payload.data) {
        if (isPlainObject(item) && isPrivyServerWalletImportedOrArchived(item)) {
          continue;
        }
        const wallet = parsePrivyServerWallet(item, params.privySub);
        if (!seenIds.has(wallet.id)) {
          seenIds.add(wallet.id);
          results.push(wallet);
        }
      }

      const nextCursor =
        typeof payload.next_cursor === "string" && payload.next_cursor.trim().length > 0
          ? payload.next_cursor.trim()
          : undefined;
      if (!nextCursor || nextCursor === cursor) {
        break;
      }
      cursor = nextCursor;
    }

    return results;
  }

  public async createEmbeddedStellarWallet(
    params: PrivyCreateWalletParams
  ): Promise<PrivyServerWalletRecord> {
    const { appId, basicCredentials } = this.assertCredentials(params);
    const baseUrl = (params.baseUrl || this.defaultBaseUrl).replace(/\/+$/, "");
    const url = `${baseUrl}/v1/wallets`;

    const requestBody: Record<string, unknown> = {
      chain_type: "stellar",
      owner: { user_id: params.privySub },
    };
    if (params.externalId) {
      requestBody.external_id = params.externalId;
    }

    const res = await this.requestWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicCredentials}`,
          "privy-app-id": appId,
          "privy-idempotency-key": params.idempotencyKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(requestBody),
      },
      {
        timeoutMs: params.timeoutMs,
        contextLabel: "Wallet creation",
        timeoutCode: "PRIVY_PROVISIONING_TIMEOUT",
        timeoutMessage: "Privy wallet provisioning request timed out.",
        privySub: params.privySub,
      }
    );

    if (!res.ok) {
      console.warn("[TrustFlow Privy] Wallet creation rejected by Privy API", {
        status: res.status,
        privySubSuffix: params.privySub.slice(-6),
      });
      if (res.status === 401 || res.status === 403) {
        throw new AppError(502, "PRIVY_API_AUTH_FAILED", "Privy server API authentication failed.");
      }
      if (res.status === 429) {
        throw new AppError(
          503,
          "PRIVY_API_RATE_LIMITED",
          "Privy wallet provisioning is temporarily rate limited."
        );
      }
      throw new AppError(502, "PRIVY_PROVISIONING_FAILED", "Privy wallet provisioning failed.");
    }

    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      throw new AppError(
        502,
        "PRIVY_RESPONSE_INVALID",
        "Received invalid JSON from Privy wallet creation."
      );
    }

    return parsePrivyServerWallet(payload, params.privySub);
  }
}
