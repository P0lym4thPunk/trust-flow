import crypto from "crypto";
import { StrKey } from "@stellar/stellar-sdk";
import { AuthRuntimeConfig } from "../config/runtime.config.js";
import { AuthRepository } from "../repositories/auth.repository.js";
import { AppError, SessionRecord, UserRecord } from "../types/backend.types.js";
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
  network: "testnet";
  custody: UserRecord["walletCustody"];
  isEmbedded: boolean;
  balanceXLM: string;
  balanceUSDC: string;
}

function isValidStellarAddress(addr: string): boolean {
  if (!addr || typeof addr !== "string" || !addr.startsWith("G") || addr.length !== 56) {
    return false;
  }
  try {
    return StrKey.isValidEd25519PublicKey(addr);
  } catch {
    return false;
  }
}

export class AuthService {
  private readonly otpStartBuckets = new Map<string, number[]>();

  private readonly privyClient: PrivyClientService;

  constructor(
    private readonly repo: AuthRepository,
    private readonly config: AuthRuntimeConfig,
    private readonly jwtVerifier: JwtVerifierService,
    private readonly otpDelivery: OtpDeliveryProvider,
    private readonly horizonUrl: string,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    privyClient?: PrivyClientService
  ) {
    this.privyClient =
      privyClient ||
      new PrivyClientService(this.fetchFn, {
        baseUrl: this.config.privyApiBaseUrl,
        timeoutMs: this.config.privyApiTimeoutMs,
      });
  }

  public getAuthCapabilities() {
    return {
      emailOtpConfigured: this.otpDelivery.isConfigured(),
      googleConfigured: Boolean(this.config.googleClientId),
      privyConfigured: Boolean(this.config.privyAppId && this.config.privyAppSecret),
      devSandboxEnabled: this.config.allowDevSandbox,
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

  public async getWalletSnapshot(user: UserRecord): Promise<WalletStatusPayload> {
    if (!user.stellarAddress) {
      return {
        address: null,
        network: "testnet",
        custody: user.walletCustody,
        isEmbedded: false,
        balanceXLM: "0.00",
        balanceUSDC: "0.00",
      };
    }

    let xlm = "0.00";
    let usdc = "0.00";
    try {
      const res = await this.fetchFn(`${this.horizonUrl}/accounts/${user.stellarAddress}`);
      if (res.ok) {
        const data = (await res.json()) as { balances?: Array<{ asset_type?: string; asset_code?: string; balance: string }> };
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
      address: user.stellarAddress,
      network: "testnet",
      custody: user.walletCustody,
      isEmbedded: user.walletCustody === "privy_embedded",
      balanceXLM: xlm,
      balanceUSDC: usdc,
    };
  }

  private async issueSession(user: UserRecord): Promise<{ token: string; user: UserRecord; wallet: WalletStatusPayload }> {
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
    let user = await this.repo.findUserByEmail(normalizedEmail);
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      user = {
        id: `usr-${crypto.randomUUID()}`,
        email: normalizedEmail,
        displayName: normalizedEmail.split("@")[0],
        avatar: "✨",
        provider: "email_otp",
        authVerified: true,
        stellarAddress: null,
        walletCustody: "none",
        isSandbox: false,
        createdAt: nowIso,
        lastLoginAt: nowIso,
      };
    } else {
      user = {
        ...user,
        lastLoginAt: nowIso,
      };
    }

    await this.repo.saveUser(user);
    const session = await this.issueSession(user);
    return { ...session, isNewUser };
  }

  public async authenticateWithGoogle(idToken: string) {
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

    let user =
      (await this.repo.findUserByProviderSubject("google", verified.sub)) ||
      (await this.repo.findUserByEmail(verified.email));
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      user = {
        id: `usr-${crypto.randomUUID()}`,
        email: verified.email,
        displayName: verified.name || verified.email.split("@")[0],
        avatar: "🌐",
        provider: "google",
        authVerified: true,
        providerSubject: verified.sub,
        stellarAddress: null,
        walletCustody: "none",
        isSandbox: false,
        createdAt: nowIso,
        lastLoginAt: nowIso,
      };
    } else {
      user = {
        ...user,
        providerSubject: user.providerSubject || verified.sub,
        displayName: verified.name || user.displayName,
        lastLoginAt: nowIso,
      };
    }

    await this.repo.saveUser(user);
    const session = await this.issueSession(user);
    return { ...session, isNewUser };
  }

  public async authenticateWithPrivy(params: {
    accessToken: string;
    stellarAddress?: string;
    email?: string;
    displayName?: string;
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

    // 1. Verify Privy access token signature and claims first
    const verified = await this.jwtVerifier.verifyPrivyAccessToken(params.accessToken, {
      appId: this.config.privyAppId,
      verificationKeyPem: this.config.privyVerificationKey,
    });

    const privySub = verified.sub;

    // 2. Fetch authoritative Privy user record and extract verified embedded Stellar wallet & profile
    const verifiedIdentity = await this.privyClient.getVerifiedUserIdentity({
      privySub,
      appId: this.config.privyAppId,
      appSecret: this.config.privyAppSecret,
    });

    const authoritativeWallet = verifiedIdentity.stellarAddress;

    // 3. Reject client-supplied wallet spoofing if stellarAddress was provided and does not match Privy
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

    // 4. Atomically lookup, validate wallet uniqueness/immutability, and upsert verified Privy user
    const { user, isNewUser } = await this.repo.upsertPrivyUser({
      privySub,
      stellarAddress: authoritativeWallet,
      email: verifiedIdentity.email,
      displayName: verifiedIdentity.displayName,
      nowIso: new Date().toISOString(),
    });

    const session = await this.issueSession(user);
    return { ...session, isNewUser };
  }

  public async linkExternalWallet(user: UserRecord, stellarAddress: string) {
    if (user.isSandbox) {
      throw new AppError(400, "SANDBOX_WALLET_LOCKED", "Development sandbox personas have fixed test addresses.");
    }
    if (!isValidStellarAddress(stellarAddress)) {
      throw new AppError(400, "INVALID_STELLAR_ADDRESS", "A valid Stellar public key (G...) is required.");
    }
    const existingOwner = await this.repo.findUserByWalletAddress(stellarAddress);
    if (existingOwner && existingOwner.id !== user.id) {
      throw new AppError(409, "WALLET_ALREADY_LINKED", "This wallet address is already bound to another account.");
    }
    const updated: UserRecord = {
      ...user,
      stellarAddress,
      walletCustody: user.provider === "privy" ? "privy_embedded" : "external_wallet",
      lastLoginAt: new Date().toISOString(),
    };
    await this.repo.saveUser(updated);
    const wallet = await this.getWalletSnapshot(updated);
    return { user: updated, wallet };
  }

  public async authenticateSandbox(personaKey: string) {
    if (!this.config.allowDevSandbox) {
      throw new AppError(403, "SANDBOX_DISABLED", "Development sandbox mode is disabled in this environment.");
    }

    const persona = SANDBOX_PERSONAS[personaKey.toLowerCase()];
    if (!persona) {
      throw new AppError(400, "INVALID_SANDBOX_PERSONA", "Unknown sandbox persona. Expected alice, bob, or charlie.");
    }

    const nowIso = new Date().toISOString();
    let user = await this.repo.findUserById(persona.id);
    if (!user) {
      user = {
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
      };
    } else {
      user = { ...user, lastLoginAt: nowIso };
    }

    await this.repo.saveUser(user);
    return this.issueSession(user);
  }

  public async getUserFromBearerToken(authHeader: string | undefined): Promise<{ user: UserRecord; session: SessionRecord } | null> {
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

    if (session.isSandbox && !this.config.allowDevSandbox) {
      await this.repo.deleteSession(token);
      return null;
    }

    const user = await this.repo.findUserById(session.userId);
    if (!user) return null;

    return { user, session };
  }

  public async revokeToken(authHeader: string | undefined): Promise<void> {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return;
    const token = authHeader.slice(7).trim();
    if (token) {
      await this.repo.deleteSession(token);
    }
  }
}
