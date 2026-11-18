import crypto from "crypto";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { AuthRuntimeConfig, parseCanonicalOrigin } from "../config/runtime.config.js";
import { AgreementRepository } from "../repositories/agreement.repository.js";
import { AuthRepository, normalizeUserWallets } from "../repositories/auth.repository.js";
import { KeyedOperationLock } from "../repositories/operationLock.js";
import {
  AppError,
  ProvisioningRecord,
  SessionRecord,
  UserRecord,
  UserWalletRecord,
  WalletChallengeRecord,
} from "../types/backend.types.js";
import { JwtVerifierService } from "./jwtVerifier.service.js";
import { PrivyClientService } from "./privyClient.service.js";

export interface OtpDeliveryProvider {
  isConfigured(): boolean;
  sendOtp(email: string, code: string): Promise<void>;
}

export class WebhookOtpDeliveryProvider implements OtpDeliveryProvider {
  constructor(
    private readonly webhookUrl: string | null,
    private readonly fetchFn: typeof fetch = globalThis.fetch
  ) {}

  isConfigured(): boolean {
    return Boolean(this.webhookUrl && this.webhookUrl.trim().length > 0);
  }

  async sendOtp(email: string, code: string): Promise<void> {
    if (!this.webhookUrl) {
      throw new AppError(
        503,
        "EMAIL_OTP_UNAVAILABLE",
        "Email verification delivery is not configured on this server."
      );
    }

    const res = await this.fetchFn(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "email_otp",
        to: email,
        code,
        subject: "Your TrustFlow verification code",
      }),
    });

    if (!res.ok) {
      throw new AppError(
        502,
        "EMAIL_OTP_DELIVERY_FAILED",
        `Email delivery provider returned status ${res.status}.`
      );
    }
  }
}

export interface SandboxPersonaDefinition {
  id: string;
  key: "alice" | "bob" | "charlie";
  displayName: string;
  avatar: string;
  roleLabel: "PAYER" | "RECIPIENT" | "APPROVER";
  stellarAddress: string;
}

export const SANDBOX_PERSONAS: Record<string, SandboxPersonaDefinition> = {
  alice: {
    id: "sandbox-alice",
    key: "alice",
    displayName: "Alice (Client / Payer)",
    avatar: "👩‍💼",
    roleLabel: "PAYER",
    stellarAddress: "GC2YDKW52O7MJ62JGPZGQSKWDN6YUHXU3M32QJQ6DFRBATWL6RIHUOP6",
  },
  bob: {
    id: "sandbox-bob",
    key: "bob",
    displayName: "Bob (Designer / Recipient)",
    avatar: "👨‍🎨",
    roleLabel: "RECIPIENT",
    stellarAddress: "GAA3NUA7AXVA54TYMPHTHB6UKZ7ZGFJHUIPOFPPU5TDL5KI2BLCBAJNX",
  },
  charlie: {
    id: "sandbox-charlie",
    key: "charlie",
    displayName: "Charlie (Approver / Reviewer)",
    avatar: "🧑‍⚖️",
    roleLabel: "APPROVER",
    stellarAddress: "GCEVSPK3KR7BHVHLBXD2IIVZBP5G4P73WBKWSA6ZWBGHB2FE7JDMZKTL",
  },
};

export interface WalletStatusPayload {
  address: string | null;
  primaryWalletAddress: string | null;
  network: "testnet";
  custody: UserRecord["walletCustody"];
  isEmbedded: boolean;
  wallets: UserWalletRecord[];
  balanceXLM: string;
  balanceUSDC: string;
}

const PRIVY_IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000;
const WALLET_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const TERMINAL_AGREEMENT_STATUSES = new Set(["RELEASED", "REFUNDED", "CANCELLED"]);

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

function decodeEd25519Base64Signature(signature: string): Buffer | null {
  const trimmed = signature.trim();
  if (!trimmed || !/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) || trimmed.length % 4 !== 0) {
    return null;
  }
  const buf = Buffer.from(trimmed, "base64");
  if (buf.length !== 64) {
    return null;
  }
  return buf;
}

function derivePrivyWalletExternalId(privySub: string): string {
  const hash = crypto.createHash("sha256").update(privySub).digest("hex").slice(0, 32);
  return `tf_st_${hash}`;
}

function normalizeExternalWalletProvider(rawProvider?: string): string {
  if (rawProvider === undefined || rawProvider === null || rawProvider.trim() === "") {
    return "freighter";
  }
  const normalized = rawProvider.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(normalized)) {
    throw new AppError(
      400,
      "INVALID_WALLET_PROVIDER",
      "External wallet provider identifier is invalid."
    );
  }
  return normalized;
}

export class AuthService {
  private readonly otpStartBuckets = new Map<string, number[]>();
  private readonly privyProvisioningLocks = new Map<string, Promise<unknown>>();
  private readonly privyClient: PrivyClientService;
  private readonly operationLock: KeyedOperationLock;

  constructor(
    private readonly repo: AuthRepository,
    private readonly config: AuthRuntimeConfig,
    private readonly jwtVerifier: JwtVerifierService,
    private readonly otpDelivery: OtpDeliveryProvider,
    private readonly horizonUrl: string,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    privyClient?: PrivyClientService,
    private readonly isProd: boolean = false,
    private readonly agreementRepo?: AgreementRepository,
    operationLock?: KeyedOperationLock
  ) {
    this.privyClient =
      privyClient ||
      new PrivyClientService(this.fetchFn, {
        baseUrl: this.config.privyApiBaseUrl,
        timeoutMs: this.config.privyApiTimeoutMs,
      });
    this.operationLock = operationLock || new KeyedOperationLock();
  }

  private resolveCanonicalSep53Domain(): string {
    if (this.config.appOriginError) {
      throw new AppError(500, "INVALID_APP_ORIGIN", this.config.appOriginError);
    }

    const configuredOrigin = this.config.appOrigin?.trim() || "";
    if (!configuredOrigin) {
      if (this.isProd) {
        throw new AppError(
          500,
          "SEP53_DOMAIN_UNCONFIGURED",
          "APP_ORIGIN must be configured in production for SEP-53 wallet domain verification."
        );
      }
      return "localhost:3000";
    }

    if (this.isProd && !this.config.hasExplicitAppOrigin) {
      throw new AppError(
        500,
        "SEP53_DOMAIN_UNCONFIGURED",
        "APP_ORIGIN must be configured in production for SEP-53 wallet domain verification."
      );
    }

    try {
      const parsed = parseCanonicalOrigin(configuredOrigin);
      if (this.config.trustedOrigins.length > 0 && !this.config.trustedOrigins.includes(parsed.origin)) {
        throw new AppError(
          500,
          "INVALID_APP_ORIGIN",
          "Configured APP_ORIGIN is not present in TRUSTED_ORIGINS."
        );
      }
      return parsed.domain;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        500,
        "INVALID_APP_ORIGIN",
        err instanceof Error ? err.message : "Configured APP_ORIGIN is invalid."
      );
    }
  }

  public getAuthCapabilities() {
    const privyConfigured = Boolean(this.config.privyAppId && this.config.privyAppSecret);
    if (this.isProd) {
      return {
        emailOtpConfigured: false,
        googleConfigured: false,
        privyConfigured,
        devSandboxEnabled: false,
        legacyAuthDisabled: true,
      };
    }

    return {
      emailOtpConfigured: this.otpDelivery.isConfigured(),
      googleConfigured: Boolean(this.config.googleClientId),
      privyConfigured,
      devSandboxEnabled: this.config.allowDevSandbox,
      legacyAuthDisabled: false,
    };
  }

  private hashOtp(email: string, code: string, salt: string): string {
    return crypto
      .createHmac("sha256", this.config.otpSecret)
      .update(`${email}:${salt}:${code}`)
      .digest("hex");
  }

  private createSessionToken(): string {
    return `tf-sess-${crypto.randomBytes(32).toString("hex")}`;
  }

  private checkOtpStartRateLimit(key: string): void {
    const now = Date.now();
    const windowStart = now - this.config.otpRateLimitWindowMs;
    const timestamps = (this.otpStartBuckets.get(key) || []).filter((ts) => ts > windowStart);
    if (timestamps.length >= this.config.otpStartRateLimitMax) {
      throw new AppError(
        429,
        "OTP_RATE_LIMITED",
        "Too many verification code requests. Please wait before trying again."
      );
    }
    timestamps.push(now);
    this.otpStartBuckets.set(key, timestamps);
  }

  private async withPrivySubLock<T>(privySub: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.privyProvisioningLocks.get(privySub) ?? Promise.resolve();
    const current = previous.then(
      () => fn(),
      () => fn()
    );
    const cleanup = current.then(
      () => {
        if (this.privyProvisioningLocks.get(privySub) === cleanup) {
          this.privyProvisioningLocks.delete(privySub);
        }
      },
      () => {
        if (this.privyProvisioningLocks.get(privySub) === cleanup) {
          this.privyProvisioningLocks.delete(privySub);
        }
      }
    );
    this.privyProvisioningLocks.set(privySub, cleanup);
    return current;
  }

  public async getWalletSnapshot(rawUser: UserRecord): Promise<WalletStatusPayload> {
    const user = normalizeUserWallets(rawUser);
    const primaryAddress = user.primaryWalletAddress ?? user.stellarAddress ?? null;

    if (!primaryAddress) {
      return {
        address: null,
        primaryWalletAddress: null,
        network: "testnet",
        custody: user.walletCustody,
        isEmbedded: false,
        wallets: user.wallets || [],
        balanceXLM: "0.00",
        balanceUSDC: "0.00",
      };
    }

    let xlm = "0.00";
    let usdc = "0.00";
    try {
      const res = await this.fetchFn(`${this.horizonUrl}/accounts/${primaryAddress}`);
      if (res.ok) {
        const data = (await res.json()) as {
          balances?: Array<{ asset_type?: string; asset_code?: string; balance: string }>;
        };
        if (Array.isArray(data.balances)) {
          for (const b of data.balances) {
            if (b.asset_type === "native") {
              xlm = parseFloat(b.balance).toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              });
            } else if (b.asset_code === "USDC") {
              usdc = parseFloat(b.balance).toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              });
            }
          }
        }
      }
    } catch {
      // Balance queries degrade gracefully without fabricating balances
    }

    return {
      address: primaryAddress,
      primaryWalletAddress: primaryAddress,
      network: "testnet",
      custody: user.walletCustody,
      isEmbedded: user.walletCustody === "privy_embedded",
      wallets: user.wallets || [],
      balanceXLM: xlm,
      balanceUSDC: usdc,
    };
  }

  private async issueSession(
    rawUser: UserRecord
  ): Promise<{ token: string; user: UserRecord; wallet: WalletStatusPayload }> {
    const user = normalizeUserWallets(rawUser);
    const token = this.createSessionToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.sessionTtlMs);

    const session: SessionRecord = {
      token,
      userId: user.id,
      provider: user.provider,
      isSandbox: user.isSandbox,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    await this.repo.saveSession(session);

    const wallet = await this.getWalletSnapshot(user);
    return { token, user, wallet };
  }

  public async startEmailOtp(email: string, clientKey: string): Promise<{ success: true; message: string }> {
    if (this.isProd) {
      throw new AppError(
        410,
        "LEGACY_AUTH_DISABLED",
        "Legacy email OTP routes are disabled in production. Authenticate with Privy instead."
      );
    }

    if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      throw new AppError(400, "INVALID_EMAIL", "A valid email address is required.");
    }

    if (!this.otpDelivery.isConfigured()) {
      throw new AppError(
        503,
        "EMAIL_OTP_UNAVAILABLE",
        "Email verification delivery is not configured on this server. Configure an email delivery provider or use test sandbox mode in development."
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    this.checkOtpStartRateLimit(`email:${normalizedEmail}`);
    this.checkOtpStartRateLimit(`ip:${clientKey}`);

    const code = crypto.randomInt(100000, 1000000).toString();
    const salt = crypto.randomBytes(16).toString("hex");
    const codeHash = this.hashOtp(normalizedEmail, code, salt);

    await this.repo.saveOtp(normalizedEmail, {
      email: normalizedEmail,
      codeHash,
      salt,
      expiresAt: Date.now() + this.config.otpTtlMs,
      attempts: 0,
      maxAttempts: this.config.otpMaxAttempts,
      createdAt: Date.now(),
    });

    await this.otpDelivery.sendOtp(normalizedEmail, code);

    return {
      success: true,
      message: `Verification code sent to ${normalizedEmail}.`,
    };
  }

  public async verifyEmailOtp(email: string, code: string) {
    if (this.isProd) {
      throw new AppError(
        410,
        "LEGACY_AUTH_DISABLED",
        "Legacy email OTP routes are disabled in production. Authenticate with Privy instead."
      );
    }

    if (!email || typeof email !== "string" || !code || typeof code !== "string") {
      throw new AppError(400, "MISSING_OTP_FIELDS", "Email and verification code are required.");
    }

    const normalizedEmail = email.trim().toLowerCase();
    const record = await this.repo.findOtp(normalizedEmail);
    if (!record) {
      throw new AppError(401, "INVALID_OTP", "Invalid or expired verification code.");
    }

    if (Date.now() > record.expiresAt) {
      await this.repo.deleteOtp(normalizedEmail);
      throw new AppError(401, "OTP_EXPIRED", "Verification code has expired. Request a new code.");
    }

    if (record.attempts >= record.maxAttempts) {
      await this.repo.deleteOtp(normalizedEmail);
      throw new AppError(429, "OTP_ATTEMPTS_EXCEEDED", "Too many failed verification attempts. Request a new code.");
    }

    const candidateHash = this.hashOtp(normalizedEmail, code.trim(), record.salt);
    const expectedBuf = Buffer.from(record.codeHash, "hex");
    const actualBuf = Buffer.from(candidateHash, "hex");

    const matches = expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);
    if (!matches) {
      const nextAttempts = record.attempts + 1;
      if (nextAttempts >= record.maxAttempts) {
        await this.repo.deleteOtp(normalizedEmail);
        throw new AppError(429, "OTP_ATTEMPTS_EXCEEDED", "Too many failed verification attempts. Request a new code.");
      }
      await this.repo.saveOtp(normalizedEmail, { ...record, attempts: nextAttempts });
      throw new AppError(401, "INVALID_OTP", "Invalid verification code.");
    }

    await this.repo.deleteOtp(normalizedEmail);

    const nowIso = new Date().toISOString();
    let user = await this.repo.findUserByProviderAndEmail("email_otp", normalizedEmail);
    let isNewUser = false;

    if (!user) {
      const colliding = await this.repo.findUserByEmail(normalizedEmail);
      if (colliding && colliding.provider !== "email_otp") {
        throw new AppError(
          409,
          "CROSS_PROVIDER_EMAIL_CONFLICT",
          "An account with this email already exists under another authentication provider."
        );
      }

      isNewUser = true;
      user = normalizeUserWallets({
        id: `usr-${crypto.randomUUID()}`,
        email: normalizedEmail,
        displayName: normalizedEmail.split("@")[0],
        avatar: "✨",
        provider: "email_otp",
        authVerified: true,
        stellarAddress: null,
        walletCustody: "none",
        wallets: [],
        primaryWalletAddress: null,
        isSandbox: false,
        createdAt: nowIso,
        lastLoginAt: nowIso,
      });
    } else {
      user = normalizeUserWallets({
        ...user,
        lastLoginAt: nowIso,
      });
    }

    await this.repo.saveUser(user);
    const session = await this.issueSession(user);
    return { ...session, isNewUser };
  }

  public async authenticateWithGoogle(idToken: string) {
    if (this.isProd) {
      throw new AppError(
        410,
        "LEGACY_AUTH_DISABLED",
        "Legacy Google login is disabled in production. Authenticate with Privy instead."
      );
    }

    if (!this.config.googleClientId) {
      throw new AppError(
        503,
        "GOOGLE_AUTH_UNAVAILABLE",
        "Google Sign-In is not configured on this server (missing GOOGLE_CLIENT_ID)."
      );
    }

    if (!idToken || typeof idToken !== "string") {
      throw new AppError(400, "MISSING_GOOGLE_TOKEN", "A verified Google ID token (idToken) is required.");
    }

    const verified = await this.jwtVerifier.verifyGoogleIdToken(idToken, this.config.googleClientId);
    const nowIso = new Date().toISOString();

    let user = await this.repo.findUserByProviderSubject("google", verified.sub);
    let isNewUser = false;

    if (!user) {
      const colliding = await this.repo.findUserByEmail(verified.email);
      if (colliding) {
        throw new AppError(
          409,
          "CROSS_PROVIDER_EMAIL_CONFLICT",
          "An account with this email already exists under another authentication provider or identity."
        );
      }

      isNewUser = true;
      user = normalizeUserWallets({
        id: `usr-${crypto.randomUUID()}`,
        email: verified.email,
        displayName: verified.name || verified.email.split("@")[0],
        avatar: "🌐",
        provider: "google",
        authVerified: true,
        providerSubject: verified.sub,
        stellarAddress: null,
        walletCustody: "none",
        wallets: [],
        primaryWalletAddress: null,
        isSandbox: false,
        createdAt: nowIso,
        lastLoginAt: nowIso,
      });
    } else {
      user = normalizeUserWallets({
        ...user,
        providerSubject: user.providerSubject || verified.sub,
        displayName: verified.name || user.displayName,
        lastLoginAt: nowIso,
      });
    }

    await this.repo.saveUser(user);
    const session = await this.issueSession(user);
    return { ...session, isNewUser };
  }

  private async markProvisioningCompleted(
    privySub: string,
    wallet: { address: string; walletId: string | null },
    externalId: string
  ): Promise<void> {
    const existing = await this.repo.getProvisioningRecord(privySub);
    if (!existing) return;

    const nowIso = new Date().toISOString();
    await this.repo.updateProvisioningRecord(privySub, (current) => ({
      privySub,
      status: "completed",
      idempotencyKey: current?.idempotencyKey || existing.idempotencyKey,
      idempotencyCreatedAt: current?.idempotencyCreatedAt || existing.idempotencyCreatedAt,
      externalId: current?.externalId || externalId,
      walletId: wallet.walletId ?? current?.walletId ?? null,
      stellarAddress: wallet.address,
      attempts: current?.attempts ?? existing.attempts,
      createdAt: current?.createdAt || existing.createdAt,
      updatedAt: nowIso,
      lastAttemptAt: current?.lastAttemptAt || nowIso,
      lastErrorCode: null,
      lastErrorMessage: null,
    }));
  }

  private async resolveOrProvisionEmbeddedStellarWallet(params: {
    privySub: string;
    appId: string;
    appSecret: string;
    disableAutoProvision?: boolean;
  }): Promise<{
    address: string;
    walletId: string | null;
    email: string | null;
    displayName: string | null;
  }> {
    const { privySub, appId, appSecret } = params;
    const externalId = derivePrivyWalletExternalId(privySub);

    // 1. Authoritative Privy user lookup
    const initialUser = await this.privyClient.getUser({ privySub, appId, appSecret });

    if (initialUser.embeddedWallets.length > 1) {
      throw new AppError(
        409,
        "MULTIPLE_EMBEDDED_STELLAR_WALLETS",
        "Multiple embedded Stellar wallets are linked to this Privy account. Explicit resolution is required."
      );
    }

    if (initialUser.embeddedWallets.length === 1) {
      const existing = initialUser.embeddedWallets[0];
      await this.markProvisioningCompleted(privySub, existing, externalId);
      return {
        address: existing.address,
        walletId: existing.walletId,
        email: initialUser.email,
        displayName: initialUser.displayName,
      };
    }

    // Preserve VITE_PRIVY_WALLET_TEST_MODE explicit guard strictly outside production
    if (!this.isProd && params.disableAutoProvision === true) {
      throw new AppError(
        403,
        "NO_EMBEDDED_STELLAR_WALLET",
        initialUser.sawExternalStellarWallet
          ? "Privy account has only an external Stellar wallet; an embedded Privy Stellar wallet is required."
          : "Privy account does not have a linked embedded Stellar wallet."
      );
    }

    // 2. Check authoritative Privy wallet list before issuing any provisioning request
    const listedWallets = await this.privyClient.listUserStellarWallets({ privySub, appId, appSecret });
    if (listedWallets.length > 1) {
      throw new AppError(
        409,
        "MULTIPLE_EMBEDDED_STELLAR_WALLETS",
        "Multiple embedded Stellar wallets exist for this Privy account. Explicit resolution is required."
      );
    }
    if (listedWallets.length === 1) {
      const existing = { address: listedWallets[0].address, walletId: listedWallets[0].id };
      await this.markProvisioningCompleted(privySub, existing, externalId);
      return {
        address: existing.address,
        walletId: existing.walletId,
        email: initialUser.email,
        displayName: initialUser.displayName,
      };
    }

    // 3. Coordinate provisioning using persistent .data/provisioning.json state
    const existingProv = await this.repo.getProvisioningRecord(privySub);
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    const canReuseIdempotencyKey = Boolean(
      existingProv?.idempotencyKey &&
        existingProv?.idempotencyCreatedAt &&
        nowMs - Date.parse(existingProv.idempotencyCreatedAt) < PRIVY_IDEMPOTENCY_WINDOW_MS
    );

    const idempotencyKey = canReuseIdempotencyKey
      ? existingProv!.idempotencyKey
      : `tf-prov-${crypto.randomUUID()}`;
    const idempotencyCreatedAt = canReuseIdempotencyKey
      ? existingProv!.idempotencyCreatedAt
      : nowIso;

    await this.repo.updateProvisioningRecord(privySub, (current): ProvisioningRecord => ({
      privySub,
      status: "pending",
      idempotencyKey,
      idempotencyCreatedAt,
      externalId,
      walletId: current?.walletId ?? null,
      stellarAddress: current?.stellarAddress ?? null,
      attempts: (current?.attempts ?? 0) + 1,
      createdAt: current?.createdAt || nowIso,
      updatedAt: nowIso,
      lastAttemptAt: nowIso,
      lastErrorCode: null,
      lastErrorMessage: null,
    }));

    let createdWallet;
    try {
      createdWallet = await this.privyClient.createEmbeddedStellarWallet({
        privySub,
        appId,
        appSecret,
        idempotencyKey,
        externalId,
      });
    } catch (createErr: unknown) {
      const errorCode = createErr instanceof AppError ? createErr.code : "PRIVY_PROVISIONING_FAILED";
      const errorMsg =
        createErr instanceof Error ? createErr.message : "Privy wallet provisioning request did not finish cleanly.";

      await this.repo.updateProvisioningRecord(privySub, (current): ProvisioningRecord => ({
        privySub,
        status: "ambiguous",
        idempotencyKey,
        idempotencyCreatedAt,
        externalId,
        walletId: current?.walletId ?? null,
        stellarAddress: current?.stellarAddress ?? null,
        attempts: current?.attempts ?? 1,
        createdAt: current?.createdAt || nowIso,
        updatedAt: new Date().toISOString(),
        lastAttemptAt: current?.lastAttemptAt || nowIso,
        lastErrorCode: errorCode,
        lastErrorMessage: errorMsg,
      }));

      // Reconcile against authoritative Privy user and wallet endpoints before declaring failure
      try {
        const reconciledUser = await this.privyClient.getUser({ privySub, appId, appSecret });
        if (reconciledUser.embeddedWallets.length > 1) {
          throw new AppError(
            409,
            "MULTIPLE_EMBEDDED_STELLAR_WALLETS",
            "Multiple embedded Stellar wallets are linked to this Privy account."
          );
        }
        if (reconciledUser.embeddedWallets.length === 1) {
          const recovered = reconciledUser.embeddedWallets[0];
          await this.markProvisioningCompleted(privySub, recovered, externalId);
          return {
            address: recovered.address,
            walletId: recovered.walletId,
            email: reconciledUser.email ?? initialUser.email,
            displayName: reconciledUser.displayName ?? initialUser.displayName,
          };
        }

        const reconciledList = await this.privyClient.listUserStellarWallets({ privySub, appId, appSecret });
        if (reconciledList.length > 1) {
          throw new AppError(
            409,
            "MULTIPLE_EMBEDDED_STELLAR_WALLETS",
            "Multiple embedded Stellar wallets are linked to this Privy account."
          );
        }
        if (reconciledList.length === 1) {
          const recovered = { address: reconciledList[0].address, walletId: reconciledList[0].id };
          await this.markProvisioningCompleted(privySub, recovered, externalId);
          return {
            address: recovered.address,
            walletId: recovered.walletId,
            email: reconciledUser.email ?? initialUser.email,
            displayName: reconciledUser.displayName ?? initialUser.displayName,
          };
        }

        await this.repo.updateProvisioningRecord(privySub, (current): ProvisioningRecord => ({
          privySub,
          status: "failed",
          idempotencyKey,
          idempotencyCreatedAt,
          externalId,
          walletId: null,
          stellarAddress: null,
          attempts: current?.attempts ?? 1,
          createdAt: current?.createdAt || nowIso,
          updatedAt: new Date().toISOString(),
          lastAttemptAt: current?.lastAttemptAt || nowIso,
          lastErrorCode: errorCode,
          lastErrorMessage: errorMsg,
        }));
      } catch (reconcileErr) {
        if (reconcileErr instanceof AppError && reconcileErr.code === "MULTIPLE_EMBEDDED_STELLAR_WALLETS") {
          await this.repo.updateProvisioningRecord(privySub, (current): ProvisioningRecord => ({
            privySub,
            status: "failed",
            idempotencyKey,
            idempotencyCreatedAt,
            externalId,
            walletId: null,
            stellarAddress: null,
            attempts: current?.attempts ?? 1,
            createdAt: current?.createdAt || nowIso,
            updatedAt: new Date().toISOString(),
            lastAttemptAt: current?.lastAttemptAt || nowIso,
            lastErrorCode: reconcileErr.code,
            lastErrorMessage: reconcileErr.message,
          }));
          throw reconcileErr;
        }
        // Leave record in "ambiguous" state if re-query itself failed so next sync reconciles safely
      }

      throw createErr;
    }

    // 4. Verify the newly provisioned wallet against authoritative Privy state before binding user
    const verifiedUser = await this.privyClient.getUser({ privySub, appId, appSecret });
    if (verifiedUser.embeddedWallets.length > 1) {
      throw new AppError(
        409,
        "MULTIPLE_EMBEDDED_STELLAR_WALLETS",
        "Multiple embedded Stellar wallets are linked to this Privy account."
      );
    }

    let authoritativeAddress: string | null = null;
    let authoritativeWalletId: string | null = createdWallet.id;

    if (verifiedUser.embeddedWallets.length === 1) {
      if (verifiedUser.embeddedWallets[0].address !== createdWallet.address) {
        throw new AppError(
          502,
          "PRIVY_RESPONSE_INVALID",
          "Provisioned wallet does not match authoritative Privy user wallet state."
        );
      }
      authoritativeAddress = verifiedUser.embeddedWallets[0].address;
      authoritativeWalletId = verifiedUser.embeddedWallets[0].walletId ?? createdWallet.id;
    } else {
      const verifiedList = await this.privyClient.listUserStellarWallets({ privySub, appId, appSecret });
      if (verifiedList.length > 1) {
        throw new AppError(
          409,
          "MULTIPLE_EMBEDDED_STELLAR_WALLETS",
          "Multiple embedded Stellar wallets are linked to this Privy account."
        );
      }
      if (verifiedList.length === 1) {
        if (verifiedList[0].address !== createdWallet.address) {
          throw new AppError(
            502,
            "PRIVY_RESPONSE_INVALID",
            "Provisioned wallet does not match authoritative Privy wallet list state."
          );
        }
        authoritativeAddress = verifiedList[0].address;
        authoritativeWalletId = verifiedList[0].id;
      }
    }

    if (!authoritativeAddress) {
      throw new AppError(
        502,
        "PRIVY_PROVISIONING_UNCONFIRMED",
        "Privy wallet creation completed, but authoritative wallet verification could not confirm the wallet."
      );
    }

    await this.repo.updateProvisioningRecord(privySub, (current): ProvisioningRecord => ({
      privySub,
      status: "completed",
      idempotencyKey,
      idempotencyCreatedAt,
      externalId,
      walletId: authoritativeWalletId,
      stellarAddress: authoritativeAddress,
      attempts: current?.attempts ?? 1,
      createdAt: current?.createdAt || nowIso,
      updatedAt: new Date().toISOString(),
      lastAttemptAt: current?.lastAttemptAt || nowIso,
      lastErrorCode: null,
      lastErrorMessage: null,
    }));

    return {
      address: authoritativeAddress,
      walletId: authoritativeWalletId,
      email: verifiedUser.email ?? initialUser.email,
      displayName: verifiedUser.displayName ?? initialUser.displayName,
    };
  }

  public async authenticateWithPrivy(params: {
    accessToken: string;
    stellarAddress?: string;
    email?: string;
    displayName?: string;
    disableAutoProvision?: boolean;
  }) {
    if (!this.config.privyAppId) {
      throw new AppError(
        503,
        "PRIVY_AUTH_UNAVAILABLE",
        "Privy authentication is not configured on this server (missing PRIVY_APP_ID)."
      );
    }

    if (!this.config.privyAppSecret) {
      throw new AppError(
        503,
        "PRIVY_CREDENTIALS_MISSING",
        "Privy server verification credentials are not configured on this server (missing PRIVY_APP_SECRET)."
      );
    }

    if (!params.accessToken || typeof params.accessToken !== "string") {
      throw new AppError(401, "MISSING_PRIVY_TOKEN", "A verified Privy access token is required.");
    }

    const privyAppId = this.config.privyAppId;
    const privyAppSecret = this.config.privyAppSecret;

    // 1. Verify Privy access token signature and claims first
    const verified = await this.jwtVerifier.verifyPrivyAccessToken(params.accessToken, {
      appId: privyAppId,
      verificationKeyPem: this.config.privyVerificationKey,
    });

    const privySub = verified.sub;

    // 2. Serialize per-subject lookup / provisioning / user upsert inside this process
    return this.withPrivySubLock(privySub, async () => {
      const resolvedWallet = await this.resolveOrProvisionEmbeddedStellarWallet({
        privySub,
        appId: privyAppId,
        appSecret: privyAppSecret,
        disableAutoProvision: params.disableAutoProvision,
      });

      const authoritativeWallet = resolvedWallet.address;

      // Reject client-supplied wallet spoofing if stellarAddress was provided and does not match Privy
      if (params.stellarAddress !== undefined && params.stellarAddress !== null) {
        if (typeof params.stellarAddress !== "string") {
          throw new AppError(400, "INVALID_STELLAR_ADDRESS", "Provided Stellar wallet address is invalid.");
        }
        const submittedWallet = params.stellarAddress.trim();
        if (submittedWallet.length > 0) {
          if (!isValidStellarAddress(submittedWallet)) {
            throw new AppError(400, "INVALID_STELLAR_ADDRESS", "Provided Stellar wallet address is invalid.");
          }
          if (submittedWallet !== authoritativeWallet) {
            throw new AppError(
              403,
              "WALLET_OWNERSHIP_MISMATCH",
              "Submitted Stellar wallet address does not match the verified Privy embedded wallet."
            );
          }
        }
      }

      const { user, isNewUser } = await this.repo.upsertPrivyUser({
        privySub,
        stellarAddress: authoritativeWallet,
        privyWalletId: resolvedWallet.walletId,
        email: resolvedWallet.email,
        displayName: resolvedWallet.displayName,
        nowIso: new Date().toISOString(),
      });

      const session = await this.issueSession(user);
      return { ...session, isNewUser };
    });
  }

  public async linkExternalWallet(_user: UserRecord, _stellarAddress: string): Promise<never> {
    throw new AppError(
      410,
      "LEGACY_WALLET_LINK_DISABLED",
      "Direct address-only wallet linking has been retired. Verify wallet ownership via /api/auth/wallets/external/challenge and SEP-53 signing."
    );
  }

  public async createExternalWalletChallenge(
    user: UserRecord,
    rawAddress: string,
    rawProvider?: string
  ): Promise<{
    challengeId: string;
    address: string;
    provider: string;
    network: "testnet";
    domain: string;
    nonce: string;
    message: string;
    expiresAt: string;
  }> {
    if (user.isSandbox) {
      throw new AppError(400, "SANDBOX_WALLET_LOCKED", "Development sandbox personas have fixed test addresses.");
    }

    const address = typeof rawAddress === "string" ? rawAddress.trim() : "";
    if (!isValidStellarAddress(address)) {
      throw new AppError(400, "INVALID_STELLAR_ADDRESS", "A valid Stellar public key (G...) is required.");
    }

    const provider = normalizeExternalWalletProvider(rawProvider);
    const canonicalDomain = this.resolveCanonicalSep53Domain();

    const existingOwner = await this.repo.findUserByWalletAddress(address);
    if (existingOwner) {
      throw new AppError(
        409,
        "WALLET_ALREADY_LINKED",
        existingOwner.id === user.id
          ? "This Stellar wallet address is already linked to your account."
          : "This wallet address is already bound to another account."
      );
    }

    const now = Date.now();
    const createdAt = new Date(now).toISOString();
    const expiresAt = new Date(now + WALLET_CHALLENGE_TTL_MS).toISOString();
    const nonce = crypto.randomBytes(24).toString("hex");

    const message = [
      "TrustFlow Stellar Wallet Verification",
      `Domain: ${canonicalDomain}`,
      "Network: testnet",
      `User: ${user.id}`,
      `Account: ${address}`,
      `Nonce: ${nonce}`,
      `Issued At: ${createdAt}`,
      `Expires At: ${expiresAt}`,
    ].join("\n");

    const challenge: WalletChallengeRecord = {
      id: `wch-${crypto.randomUUID()}`,
      userId: user.id,
      address,
      provider,
      network: "testnet",
      domain: canonicalDomain,
      nonce,
      message,
      createdAt,
      expiresAt,
      consumedAt: null,
    };

    await this.repo.saveWalletChallenge(challenge);

    return {
      challengeId: challenge.id,
      address: challenge.address,
      provider: challenge.provider,
      network: challenge.network,
      domain: challenge.domain,
      nonce: challenge.nonce,
      message: challenge.message,
      expiresAt: challenge.expiresAt,
    };
  }

  public async verifyExternalWalletChallenge(
    user: UserRecord,
    params: { challengeId?: string; address?: string; signature?: string }
  ): Promise<{ user: UserRecord; wallet: WalletStatusPayload; linkedWallet: UserWalletRecord }> {
    if (user.isSandbox) {
      throw new AppError(400, "SANDBOX_WALLET_LOCKED", "Development sandbox personas have fixed test addresses.");
    }

    const challengeId = typeof params.challengeId === "string" ? params.challengeId.trim() : "";
    const address = typeof params.address === "string" ? params.address.trim() : "";
    const signature = typeof params.signature === "string" ? params.signature.trim() : "";

    if (!challengeId) {
      throw new AppError(400, "MISSING_CHALLENGE_ID", "Wallet verification challengeId is required.");
    }
    if (!isValidStellarAddress(address)) {
      throw new AppError(400, "INVALID_STELLAR_ADDRESS", "A valid Stellar public key (G...) is required.");
    }

    const signatureBuf = decodeEd25519Base64Signature(signature);
    if (!signatureBuf) {
      throw new AppError(
        400,
        "INVALID_WALLET_SIGNATURE",
        "Wallet signature must be a valid base64-encoded 64-byte Ed25519 signature."
      );
    }

    const canonicalDomain = this.resolveCanonicalSep53Domain();

    return this.operationLock.withLocks([`user:${user.id}`, `wallet:${address}`], async () => {
      const nowIso = new Date().toISOString();
      const challenge = await this.repo.findWalletChallenge(challengeId);
      if (!challenge) {
        throw new AppError(404, "CHALLENGE_NOT_FOUND", "Wallet verification challenge was not found.");
      }
      if (challenge.userId !== user.id) {
        throw new AppError(
          403,
          "CHALLENGE_USER_MISMATCH",
          "This wallet verification challenge belongs to a different user."
        );
      }
      if (challenge.address !== address) {
        throw new AppError(
          400,
          "CHALLENGE_ADDRESS_MISMATCH",
          "Submitted wallet address does not match the verification challenge."
        );
      }
      if (challenge.consumedAt) {
        throw new AppError(
          409,
          "CHALLENGE_ALREADY_USED",
          "This wallet verification challenge has already been used. Request a new challenge."
        );
      }
      if (Date.parse(challenge.expiresAt) <= Date.parse(nowIso)) {
        throw new AppError(
          401,
          "CHALLENGE_EXPIRED",
          "Wallet verification challenge has expired. Request a new challenge."
        );
      }

      const verifyChallengeDomainAndSignature = (candidate: WalletChallengeRecord): void => {
        if (
          candidate.domain !== canonicalDomain ||
          !candidate.message.includes(`Domain: ${canonicalDomain}\n`)
        ) {
          throw new AppError(
            403,
            "INVALID_CHALLENGE_DOMAIN",
            "Wallet verification challenge domain does not match the configured application origin."
          );
        }

        let verified = false;
        try {
          verified = Keypair.fromPublicKey(candidate.address).verifyMessage(
            candidate.message,
            signatureBuf
          );
        } catch {
          verified = false;
        }
        if (!verified) {
          throw new AppError(
            401,
            "INVALID_WALLET_SIGNATURE",
            "Stellar SEP-53 signature verification failed for the provided wallet."
          );
        }
      };

      verifyChallengeDomainAndSignature(challenge);

      // Verify global uniqueness BEFORE consuming the valid challenge so a failed uniqueness check never burns it
      const existingOwner = await this.repo.findUserByWalletAddress(address);
      if (existingOwner) {
        throw new AppError(
          409,
          "WALLET_ALREADY_LINKED",
          existingOwner.id === user.id
            ? "This Stellar wallet address is already linked to your account."
            : "This wallet address is already bound to another account."
        );
      }

      const consumedChallenge = await this.repo.consumeWalletChallenge({
        challengeId,
        userId: user.id,
        address,
        nowIso,
        verifyFn: verifyChallengeDomainAndSignature,
      });

      const linkedWallet: UserWalletRecord = {
        id: `wal-ext-${crypto.randomUUID()}`,
        address,
        custody: "external_wallet",
        provider: consumedChallenge.provider || "freighter",
        privyWalletId: null,
        verificationMethod: "sep53",
        verifiedAt: nowIso,
        linkedAt: nowIso,
        unlinkedAt: null,
        status: "active",
        isPrimary: false,
      };

      const updatedUser = await this.repo.linkExternalWalletToUser({
        userId: user.id,
        wallet: linkedWallet,
        nowIso,
      });

      const storedWallet =
        (updatedUser.wallets || []).find((w) => w.id === linkedWallet.id) || linkedWallet;
      const wallet = await this.getWalletSnapshot(updatedUser);
      return { user: updatedUser, wallet, linkedWallet: storedWallet };
    });
  }

  public async unlinkExternalWallet(
    rawUser: UserRecord,
    walletId: string
  ): Promise<{ user: UserRecord; wallet: WalletStatusPayload; unlinkedWallet: UserWalletRecord }> {
    const caller = normalizeUserWallets(rawUser);
    if (caller.isSandbox) {
      throw new AppError(400, "SANDBOX_WALLET_LOCKED", "Development sandbox personas have fixed test addresses.");
    }

    const cleanWalletId = typeof walletId === "string" ? walletId.trim() : "";
    if (!cleanWalletId) {
      throw new AppError(400, "MISSING_WALLET_ID", "A wallet ID is required.");
    }

    return this.operationLock.withLock(`user:${caller.id}`, async () => {
      const freshUser = (await this.repo.findUserById(caller.id)) ?? caller;
      const normalized = normalizeUserWallets(freshUser);

      const target = (normalized.wallets || []).find(
        (w) => w.id === cleanWalletId && w.status === "active"
      );
      if (!target) {
        throw new AppError(404, "WALLET_NOT_FOUND", "Active wallet record was not found on this account.");
      }
      if (target.custody === "privy_embedded") {
        throw new AppError(
          403,
          "EMBEDDED_WALLET_IMMUTABLE",
          "Privy embedded Stellar wallets cannot be unlinked or replaced."
        );
      }

      if (this.agreementRepo) {
        const agreements = await this.agreementRepo.findAll();
        const activeUsage = agreements.find(
          (agr) =>
            !TERMINAL_AGREEMENT_STATUSES.has(agr.status) &&
            (agr.terms.payer === target.address ||
              agr.terms.recipient === target.address ||
              agr.terms.approver === target.address)
        );
        if (activeUsage) {
          throw new AppError(
            409,
            "WALLET_IN_ACTIVE_AGREEMENT",
            "Cannot unlink a wallet referenced by an active agreement. Complete or cancel the agreement first."
          );
        }
      }

      const nowIso = new Date().toISOString();
      const { user: updatedUser, unlinkedWallet } = await this.repo.unlinkExternalWalletFromUser({
        userId: normalized.id,
        walletId: cleanWalletId,
        nowIso,
      });

      const wallet = await this.getWalletSnapshot(updatedUser);
      return { user: updatedUser, wallet, unlinkedWallet };
    });
  }

  public async authenticateSandbox(personaKey: string) {
    if (this.isProd || !this.config.allowDevSandbox) {
      throw new AppError(403, "SANDBOX_DISABLED", "Development sandbox mode is disabled in this environment.");
    }

    const persona = SANDBOX_PERSONAS[personaKey.toLowerCase()];
    if (!persona) {
      throw new AppError(400, "INVALID_SANDBOX_PERSONA", "Unknown sandbox persona. Expected alice, bob, or charlie.");
    }

    const nowIso = new Date().toISOString();
    let user = await this.repo.findUserById(persona.id);
    if (!user) {
      user = normalizeUserWallets({
        id: persona.id,
        email: `${persona.key}@sandbox.trustflow.local`,
        displayName: persona.displayName,
        avatar: persona.avatar,
        provider: "dev_sandbox",
        authVerified: true,
        providerSubject: persona.id,
        stellarAddress: persona.stellarAddress,
        walletCustody: "dev_sandbox",
        isSandbox: true,
        createdAt: nowIso,
        lastLoginAt: nowIso,
      });
    } else {
      user = normalizeUserWallets({ ...user, lastLoginAt: nowIso });
    }

    await this.repo.saveUser(user);
    return this.issueSession(user);
  }

  public async getUserFromBearerToken(
    authHeader: string | undefined
  ): Promise<{ user: UserRecord; session: SessionRecord } | null> {
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return null;
    }
    const token = authHeader.slice(7).trim();
    if (!token) return null;

    const session = await this.repo.findSession(token);
    if (!session) return null;

    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      await this.repo.deleteSession(token);
      return null;
    }

    if (session.isSandbox && (this.isProd || !this.config.allowDevSandbox)) {
      await this.repo.deleteSession(token);
      return null;
    }

    const user = await this.repo.findUserById(session.userId);
    if (!user) return null;

    return { user: normalizeUserWallets(user), session };
  }

  public async revokeToken(authHeader: string | undefined): Promise<void> {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return;
    const token = authHeader.slice(7).trim();
    if (token) {
      await this.repo.deleteSession(token);
    }
  }
}
