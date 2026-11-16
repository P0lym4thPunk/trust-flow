import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import {
  createBackendApp,
  FileAuthRepository,
  type AuthRepository,
} from "../backend/src/index";
import { getRuntimeConfig } from "../backend/src/config/runtime.config";
import { SANDBOX_PERSONAS, OtpDeliveryProvider } from "../backend/src/services/auth.service";
import { fallbackDraft, sanitizeForAi } from "../backend/src/services/ai.service";
import { AgreementRecord } from "../backend/src/types/backend.types";

const ALICE_ADDR = SANDBOX_PERSONAS.alice.stellarAddress;
const BOB_ADDR = SANDBOX_PERSONAS.bob.stellarAddress;
const CHARLIE_ADDR = SANDBOX_PERSONAS.charlie.stellarAddress;

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf-8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signRsaJwt(
  payload: Record<string, unknown>,
  privateKeyPem: string,
  kid = "test-rsa-key-1"
): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${body}`);
  const sig = signer.sign(privateKeyPem);
  return `${header}.${body}.${base64UrlEncode(sig)}`;
}

function signEs256Jwt(
  payload: Record<string, unknown>,
  privateKeyPem: string,
  kid = "test-ec-key-1"
): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "ES256", typ: "JWT", kid }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.sign("sha256", Buffer.from(`${header}.${body}`, "utf-8"), {
    key: privateKeyPem,
    dsaEncoding: "ieee-p1363",
  });
  return `${header}.${body}.${base64UrlEncode(sig)}`;
}

async function startIsolatedServer(options: {
  tempDir: string;
  allowDevSandbox?: boolean;
  isProd?: boolean;
  googleClientId?: string | null;
  privyAppId?: string | null;
  privyAppSecret?: string | null;
  privyVerificationKey?: string | null;
  privyApiTimeoutMs?: number;
  otpDelivery?: OtpDeliveryProvider;
  otpTtlMs?: number;
  otpMaxAttempts?: number;
  otpStartRateLimitMax?: number;
  aiRateLimitMax?: number;
  aiMaxInputChars?: number;
  fetchFn?: typeof fetch;
}) {
  const baseCfg = getRuntimeConfig({
    dataDir: options.tempDir,
    allowDevSandbox: options.allowDevSandbox ?? true,
  });

  if (options.isProd !== undefined) {
    baseCfg.isProd = options.isProd;
    baseCfg.nodeEnv = options.isProd ? "production" : "development";
  }
  baseCfg.auth.googleClientId = options.googleClientId ?? null;
  baseCfg.auth.privyAppId = options.privyAppId ?? null;
  baseCfg.auth.privyAppSecret = options.privyAppSecret ?? null;
  baseCfg.auth.privyVerificationKey = options.privyVerificationKey ?? null;
  if (options.privyApiTimeoutMs !== undefined) {
    baseCfg.auth.privyApiTimeoutMs = options.privyApiTimeoutMs;
  }
  if (options.otpTtlMs !== undefined) baseCfg.auth.otpTtlMs = options.otpTtlMs;
  if (options.otpMaxAttempts !== undefined) baseCfg.auth.otpMaxAttempts = options.otpMaxAttempts;
  if (options.otpStartRateLimitMax !== undefined) {
    baseCfg.auth.otpStartRateLimitMax = options.otpStartRateLimitMax;
  }
  if (options.aiRateLimitMax !== undefined) baseCfg.ai.rateLimitMax = options.aiRateLimitMax;
  if (options.aiMaxInputChars !== undefined) baseCfg.ai.maxInputChars = options.aiMaxInputChars;

  const backend = createBackendApp({
    config: baseCfg,
    otpDelivery: options.otpDelivery,
    fetchFn: options.fetchFn,
  });

  const server = http.createServer(backend.app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    backend,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function loginSandbox(baseUrl: string, persona: "alice" | "bob" | "charlie"): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/sandbox`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ persona }),
  });
  assert.strictEqual(res.status, 200);
  const data = (await res.json()) as { token: string };
  return data.token;
}

describe("TrustFlow Phase 1 Security, Auth, Lifecycle & AI Acceptance Suite", () => {
  let tempDir: string;
  const activeClosers: Array<() => Promise<void>> = [];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trustflow-phase1-"));
  });

  afterEach(async () => {
    while (activeClosers.length > 0) {
      const close = activeClosers.pop()!;
      await close();
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("1. Email OTP Security (Fail-Closed, Hashed Storage, No Demo Code Leak)", () => {
    it("returns 503 EMAIL_OTP_UNAVAILABLE when no email delivery provider is configured", async () => {
      const srv = await startIsolatedServer({ tempDir });
      activeClosers.push(srv.close);

      const res = await fetch(`${srv.baseUrl}/api/auth/otp/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "user@example.com" }),
      });

      assert.strictEqual(res.status, 503);
      const body = (await res.json()) as any;
      assert.strictEqual(body.code, "EMAIL_OTP_UNAVAILABLE");
      assert.strictEqual(body.demoCode, undefined);
    });

    it("stores hashed OTP only, never leaks code in JSON, creates wallet-free user, and enforces attempts/rate limits", async () => {
      const sentCodes: Array<{ email: string; code: string }> = [];
      const mockProvider: OtpDeliveryProvider = {
        isConfigured: () => true,
        async sendOtp(email, code) {
          sentCodes.push({ email, code });
        },
      };

      const srv = await startIsolatedServer({
        tempDir,
        otpDelivery: mockProvider,
        otpMaxAttempts: 2,
        otpStartRateLimitMax: 3,
      });
      activeClosers.push(srv.close);

      const startRes = await fetch(`${srv.baseUrl}/api/auth/otp/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "Alice.Freelancer@example.com" }),
      });

      assert.strictEqual(startRes.status, 200);
      const startBody = (await startRes.json()) as any;
      assert.strictEqual(startBody.demoCode, undefined);
      assert.strictEqual(startBody.code, undefined);
      assert.strictEqual(sentCodes.length, 1);

      const issuedCode = sentCodes[0].code;
      assert.ok(/^\d{6}$/.test(issuedCode));

      // Verify raw OTP is NOT written to otps.json on disk
      const rawOtpStore = fs.readFileSync(path.join(tempDir, "otps.json"), "utf-8");
      assert.ok(!rawOtpStore.includes(issuedCode), "Raw OTP must never be persisted on disk");

      // Wrong code attempt 1 -> 401 INVALID_OTP
      const bad1 = await fetch(`${srv.baseUrl}/api/auth/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "Alice.Freelancer@example.com", code: "000000" }),
      });
      assert.strictEqual(bad1.status, 401);

      // Wrong code attempt 2 -> hits otpMaxAttempts -> 429 OTP_ATTEMPTS_EXCEEDED
      const bad2 = await fetch(`${srv.baseUrl}/api/auth/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "Alice.Freelancer@example.com", code: "000001" }),
      });
      assert.strictEqual(bad2.status, 429);

      // Request fresh code -> succeeds; verify user has NO fabricated wallet
      const start2 = await fetch(`${srv.baseUrl}/api/auth/otp/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "Alice.Freelancer@example.com" }),
      });
      assert.strictEqual(start2.status, 200);
      const validCode = sentCodes[1].code;

      const verifyRes = await fetch(`${srv.baseUrl}/api/auth/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "Alice.Freelancer@example.com", code: validCode }),
      });
      assert.strictEqual(verifyRes.status, 200);
      const verified = (await verifyRes.json()) as any;
      assert.ok(String(verified.token).startsWith("tf-sess-"));
      assert.strictEqual(verified.user.stellarAddress, null);
      assert.strictEqual(verified.user.walletCustody, "none");
      assert.strictEqual(verified.wallet.address, null);

      // Rate limit check (otpStartRateLimitMax = 3, already sent 2)
      const start3 = await fetch(`${srv.baseUrl}/api/auth/otp/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "Alice.Freelancer@example.com" }),
      });
      assert.strictEqual(start3.status, 200);

      const start4 = await fetch(`${srv.baseUrl}/api/auth/otp/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "Alice.Freelancer@example.com" }),
      });
      assert.strictEqual(start4.status, 429);
    });

    it("rejects expired OTP codes cleanly", async () => {
      const sentCodes: Array<{ email: string; code: string }> = [];
      const srv = await startIsolatedServer({
        tempDir,
        otpTtlMs: 25,
        otpDelivery: {
          isConfigured: () => true,
          async sendOtp(email, code) {
            sentCodes.push({ email, code });
          },
        },
      });
      activeClosers.push(srv.close);

      await fetch(`${srv.baseUrl}/api/auth/otp/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "exp@example.com" }),
      });
      await new Promise((r) => setTimeout(r, 40));

      const verifyRes = await fetch(`${srv.baseUrl}/api/auth/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "exp@example.com", code: sentCodes[0].code }),
      });
      assert.strictEqual(verifyRes.status, 401);
      const body = (await verifyRes.json()) as any;
      assert.strictEqual(body.code, "OTP_EXPIRED");
    });
  });

  describe("2. Cryptographic Google ID Token & Privy JWT Verification", () => {
    it("fails closed when Google auth is unconfigured and rejects forged/unverified Google tokens", async () => {
      const unconfigured = await startIsolatedServer({ tempDir, googleClientId: null });
      activeClosers.push(unconfigured.close);

      const resUnconf = await fetch(`${unconfigured.baseUrl}/api/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "spoof@example.com" }),
      });
      assert.strictEqual(resUnconf.status, 503);

      // Now configure Google Client ID + RS256 mock JWKS
      const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
      });
      const publicJwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
      const privPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
      const clientId = "test-google-client-id.apps.googleusercontent.com";

      const srv = await startIsolatedServer({
        tempDir: fs.mkdtempSync(path.join(os.tmpdir(), "trustflow-google-")),
        googleClientId: clientId,
        fetchFn: (async (url: string) => {
          if (url === "https://www.googleapis.com/oauth2/v3/certs") {
            return new Response(
              JSON.stringify({
                keys: [{ ...publicJwk, kid: "test-rsa-key-1", alg: "RS256", use: "sig" }],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response("{}", { status: 404 });
        }) as typeof fetch,
      });
      activeClosers.push(srv.close);

      // Raw email spoof without idToken rejected
      const spoofRes = await fetch(`${srv.baseUrl}/api/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "spoof@example.com" }),
      });
      assert.strictEqual(spoofRes.status, 400);

      // Wrong audience rejected
      const now = Math.floor(Date.now() / 1000);
      const wrongAudJwt = signRsaJwt(
        {
          iss: "https://accounts.google.com",
          aud: "wrong-client-id",
          sub: "google-sub-123",
          email: "alice@gmail.com",
          email_verified: true,
          exp: now + 300,
        },
        privPem
      );
      const wrongAudRes = await fetch(`${srv.baseUrl}/api/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: wrongAudJwt }),
      });
      assert.strictEqual(wrongAudRes.status, 401);

      // Valid Google ID token succeeds & creates user with null wallet
      const validJwt = signRsaJwt(
        {
          iss: "https://accounts.google.com",
          aud: clientId,
          sub: "google-sub-123",
          email: "alice@gmail.com",
          email_verified: true,
          name: "Alice Google",
          exp: now + 300,
        },
        privPem
      );
      const okRes = await fetch(`${srv.baseUrl}/api/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: validJwt }),
      });
      assert.strictEqual(okRes.status, 200);
      const okBody = (await okRes.json()) as any;
      assert.strictEqual(okBody.user.email, "alice@gmail.com");
      assert.strictEqual(okBody.user.stellarAddress, null);
      assert.strictEqual(okBody.user.walletCustody, "none");
    });

    it("verifies Privy ES256 JWTs cryptographically and blocks wallet overwrite hijacking", async () => {
      const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
        namedCurve: "P-256",
      });
      const pubPem = publicKey.export({ format: "pem", type: "spki" }).toString();
      const privPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
      const privyAppId = "cm-test-privy-app";
      const privyAppSecret = "privy-test-secret-xyz";
      let upstreamWallet = ALICE_ADDR;

      const srv = await startIsolatedServer({
        tempDir,
        privyAppId,
        privyAppSecret,
        privyVerificationKey: pubPem,
        fetchFn: (async (url: string) => {
          if (url === "https://api.privy.io/v1/users/did:privy:user1") {
            return new Response(
              JSON.stringify({
                id: "did:privy:user1",
                created_at: 1731974895,
                has_accepted_terms: true,
                is_guest: false,
                linked_accounts: [
                  {
                    type: "wallet",
                    id: "wlt-alice",
                    address: upstreamWallet,
                    chain_type: "stellar",
                    wallet_client_type: "privy",
                    wallet_client: "privy",
                    connector_type: "embedded",
                    verified_at: 1731974895,
                  },
                ],
                mfa_methods: [],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response("{}", { status: 404 });
        }) as typeof fetch,
      });
      activeClosers.push(srv.close);

      // Forged token rejected
      const forgedRes = await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: "eyJhbGciOiJub25lIn0.eyJzdWIiOiJkaWQ6cHJpdnk6ZmFrZSJ9.",
          stellarAddress: ALICE_ADDR,
        }),
      });
      assert.strictEqual(forgedRes.status, 401);

      const now = Math.floor(Date.now() / 1000);
      const validPrivyJwt = signEs256Jwt(
        {
          iss: "privy.io",
          aud: privyAppId,
          sub: "did:privy:user1",
          exp: now + 300,
        },
        privPem
      );

      // Valid login binds ALICE_ADDR once from authoritative Privy API
      const okRes = await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: validPrivyJwt,
          stellarAddress: ALICE_ADDR,
        }),
      });
      assert.strictEqual(okRes.status, 200);
      const okBody = (await okRes.json()) as any;
      assert.strictEqual(okBody.user.stellarAddress, ALICE_ADDR);
      assert.strictEqual(okBody.user.walletCustody, "privy_embedded");

      // Submitting a different stellarAddress is rejected with 403 WALLET_OWNERSHIP_MISMATCH
      const spoofRes = await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: validPrivyJwt,
          stellarAddress: BOB_ADDR,
        }),
      });
      assert.strictEqual(spoofRes.status, 403);
      const spoofBody = (await spoofRes.json()) as any;
      assert.strictEqual(spoofBody.code, "WALLET_OWNERSHIP_MISMATCH");

      // Even if upstream Privy ever returned a different wallet for an already-bound account -> 409 WALLET_IMMUTABLE
      upstreamWallet = BOB_ADDR;
      const immutableRes = await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: validPrivyJwt,
          stellarAddress: BOB_ADDR,
        }),
      });
      assert.strictEqual(immutableRes.status, 409);
      const immutableBody = (await immutableRes.json()) as any;
      assert.strictEqual(immutableBody.code, "WALLET_IMMUTABLE");
    });

    it("gates dev sandbox behind allowDevSandbox=true and returns 403 when disabled", async () => {
      const prodSrv = await startIsolatedServer({ tempDir, allowDevSandbox: false });
      activeClosers.push(prodSrv.close);

      const res = await fetch(`${prodSrv.baseUrl}/api/auth/sandbox`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona: "alice" }),
      });
      assert.strictEqual(res.status, 403);
      const body = (await res.json()) as any;
      assert.strictEqual(body.code, "SANDBOX_DISABLED");
    });
  });

  describe("3. Protected Endpoints, Cross-Party Authorization, Financial Spoofing & Lifecycle", () => {
    it("rejects all unauthenticated requests across agreements, ai, and escrow endpoints", async () => {
      const srv = await startIsolatedServer({ tempDir });
      activeClosers.push(srv.close);

      for (const [method, endpoint] of [
        ["GET", "/api/agreements"],
        ["GET", "/api/agreements/agr-seed-001"],
        ["POST", "/api/agreements"],
        ["POST", "/api/ai/draft"],
        ["POST", "/api/ai/check"],
        ["POST", "/api/escrow/prepare"],
      ] as const) {
        const res = await fetch(`${srv.baseUrl}${endpoint}`, {
          method,
          headers: { "Content-Type": "application/json" },
          body: method === "POST" ? "{}" : undefined,
        });
        assert.strictEqual(res.status, 401, `${method} ${endpoint} should return 401`);
      }
    });

    it("enforces role checks, post-acceptance term immutability, concurrency, cancellation & Phase 2 501 gates", async () => {
      const srv = await startIsolatedServer({ tempDir });
      activeClosers.push(srv.close);

      const aliceToken = await loginSandbox(srv.baseUrl, "alice");
      const bobToken = await loginSandbox(srv.baseUrl, "bob");
      const charlieToken = await loginSandbox(srv.baseUrl, "charlie");

      const validTerms = {
        amount: "350.00",
        asset: "USDC" as const,
        payer: ALICE_ADDR,
        recipient: BOB_ADDR,
        approver: ALICE_ADDR,
        title: "Design System Audit",
        description: "Audit Figma tokens and React accessibility",
        deliverables: ["Audit report", "Token PR"],
        condition: "Payer reviews and approves report and PR",
        cancellationTerms: "Mutual cancellation before funding",
        deadline: "2026-12-15T00:00:00.000Z",
        contractId: "PENDING_TRUSTLESS_WORK_INTEGRATION",
        domain: "trustflow.stellar.escrow.v1",
        network: "testnet" as const,
        version: 1,
      };

      // Self-payment blocked
      const selfPayRes = await fetch(`${srv.baseUrl}/api/agreements`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({
          transactionType: "WORK",
          terms: { ...validTerms, recipient: ALICE_ADDR },
        }),
      });
      assert.strictEqual(selfPayRes.status, 400);

      // Client-spoofed FUNDED status or fundingTxHash blocked with 403
      const spoofFundedRes = await fetch(`${srv.baseUrl}/api/agreements`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({
          transactionType: "WORK",
          status: "FUNDED",
          terms: validTerms,
        }),
      });
      assert.strictEqual(spoofFundedRes.status, 403);

      const spoofHashRes = await fetch(`${srv.baseUrl}/api/agreements`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({
          transactionType: "WORK",
          fundingTxHash: "tf-tx-fakehash",
          terms: validTerms,
        }),
      });
      assert.strictEqual(spoofHashRes.status, 403);

      // Valid creation by Alice
      const createRes = await fetch(`${srv.baseUrl}/api/agreements`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({ transactionType: "WORK", terms: validTerms }),
      });
      assert.strictEqual(createRes.status, 201);
      const created = (await createRes.json()) as AgreementRecord;

      // Outsider Charlie (not payer/recipient/approver here) cannot view or mutate -> 403
      const charlieGet = await fetch(`${srv.baseUrl}/api/agreements/${created.id}`, {
        headers: { Authorization: `Bearer ${charlieToken}` },
      });
      assert.strictEqual(charlieGet.status, 403);

      // Alice cannot accept on behalf of Bob -> 403
      const impersonateRes = await fetch(`${srv.baseUrl}/api/agreements/${created.id}/accept`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({
          role: "RECIPIENT",
          canonicalHash: created.canonicalHash,
        }),
      });
      assert.strictEqual(impersonateRes.status, 403);

      // Term mutation after Alice already accepted -> 409 TERMS_IMMUTABLE_AFTER_ACCEPTANCE
      const mutateAfterAccept = await fetch(
        `${srv.baseUrl}/api/agreements/${created.id}/request-changes`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${bobToken}`,
          },
          body: JSON.stringify({
            reason: "Raise amount",
            updatedTerms: { amount: "999.00" },
          }),
        }
      );
      assert.strictEqual(mutateAfterAccept.status, 409);

      // Stale expectedVersion returns 409 VERSION_CONFLICT
      const staleRes = await fetch(`${srv.baseUrl}/api/agreements/${created.id}/accept`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bobToken}`,
        },
        body: JSON.stringify({
          role: "RECIPIENT",
          canonicalHash: created.canonicalHash,
          expectedVersion: 99,
        }),
      });
      assert.strictEqual(staleRes.status, 409);

      // Pre-funding cancellation request -> withdraw -> re-request -> counterparty confirm -> CANCELLED
      const reqCancel = await fetch(
        `${srv.baseUrl}/api/agreements/${created.id}/cancel-request`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${aliceToken}`,
          },
          body: JSON.stringify({ expectedVersion: 1 }),
        }
      );
      assert.strictEqual(reqCancel.status, 200);

      const withdrawCancel = await fetch(
        `${srv.baseUrl}/api/agreements/${created.id}/cancel-withdraw`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${aliceToken}`,
          },
          body: JSON.stringify({ expectedVersion: 2 }),
        }
      );
      assert.strictEqual(withdrawCancel.status, 200);

      const reqCancel2 = await fetch(
        `${srv.baseUrl}/api/agreements/${created.id}/cancel-request`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${aliceToken}`,
          },
          body: JSON.stringify({ expectedVersion: 3 }),
        }
      );
      assert.strictEqual(reqCancel2.status, 200);

      const confirmCancel = await fetch(
        `${srv.baseUrl}/api/agreements/${created.id}/cancel-confirm`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${bobToken}`,
          },
          body: JSON.stringify({ expectedVersion: 4 }),
        }
      );
      assert.strictEqual(confirmCancel.status, 200);
      const cancelled = (await confirmCancel.json()) as AgreementRecord;
      assert.strictEqual(cancelled.status, "CANCELLED");

      // Phase 2 financial endpoints return 501 PHASE_2_REQUIRED
      for (const route of [
        `/api/agreements/${created.id}/fund`,
        `/api/agreements/${created.id}/release`,
        `/api/agreements/${created.id}/refund`,
        `/api/escrow/prepare`,
      ]) {
        const res = await fetch(`${srv.baseUrl}${route}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${aliceToken}`,
          },
          body: "{}",
        });
        assert.strictEqual(res.status, 501, `${route} must return 501`);
        const body = (await res.json()) as any;
        assert.strictEqual(body.code, "PHASE_2_REQUIRED");
      }
    });

    it("enforces approver-only approval and 501 on post-funding cancellation", async () => {
      const srv = await startIsolatedServer({ tempDir });
      activeClosers.push(srv.close);

      const bobToken = await loginSandbox(srv.baseUrl, "bob");
      const charlieToken = await loginSandbox(srv.baseUrl, "charlie");

      // Seed a FUNDED agreement directly into the isolated test repo to verify post-funding rules
      const fundedRecord: AgreementRecord = {
        id: "agr-funded-test-01",
        transactionType: "WORK",
        title: "Funded Test",
        description: "Test post-funding fulfilment and approval checks",
        terms: {
          amount: "200.00",
          asset: "USDC",
          payer: ALICE_ADDR,
          recipient: BOB_ADDR,
          approver: CHARLIE_ADDR,
          title: "Funded Test",
          description: "Test post-funding fulfilment and approval checks",
          deliverables: ["Delivered spec"],
          condition: "Reviewer approves",
          cancellationTerms: "Mutual cancellation",
          deadline: "2026-12-20T00:00:00.000Z",
          contractId: "PENDING_TRUSTLESS_WORK_INTEGRATION",
          domain: "trustflow.stellar.escrow.v1",
          network: "testnet",
          version: 1,
        },
        canonicalHash: "a".repeat(64),
        version: 1,
        status: "FUNDED",
        cancelRequest: "NONE",
        payerAccepted: true,
        recipientAccepted: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        activity: [],
      };
      await srv.backend.agreementRepo.create(fundedRecord);

      // Bob submits fulfilment
      const fulfilRes = await fetch(`${srv.baseUrl}/api/agreements/agr-funded-test-01/fulfil`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bobToken}`,
        },
        body: JSON.stringify({ notes: "https://example.com/deliverable", expectedVersion: 1 }),
      });
      assert.strictEqual(fulfilRes.status, 200);

      // Bob cannot approve own fulfilment -> 403
      const selfApprove = await fetch(`${srv.baseUrl}/api/agreements/agr-funded-test-01/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bobToken}`,
        },
        body: JSON.stringify({ expectedVersion: 2 }),
      });
      assert.strictEqual(selfApprove.status, 403);

      // Approver Charlie approves -> APPROVED
      const charlieApprove = await fetch(`${srv.baseUrl}/api/agreements/agr-funded-test-01/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${charlieToken}`,
        },
        body: JSON.stringify({ expectedVersion: 2 }),
      });
      assert.strictEqual(charlieApprove.status, 200);
      const approved = (await charlieApprove.json()) as AgreementRecord;
      assert.strictEqual(approved.status, "APPROVED");

      // Post-funding cancel-confirm requires Phase 2 -> 501
      const aliceToken = await loginSandbox(srv.baseUrl, "alice");
      await fetch(`${srv.baseUrl}/api/agreements/agr-funded-test-01/cancel-request`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({ expectedVersion: 3 }),
      });
      const postFundCancel = await fetch(
        `${srv.baseUrl}/api/agreements/agr-funded-test-01/cancel-confirm`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${bobToken}`,
          },
          body: JSON.stringify({ expectedVersion: 4 }),
        }
      );
      assert.strictEqual(postFundCancel.status, 501);
    });
  });

  describe("4. AI Runtime Model (gemini-3.8-flash), PII Redaction & Safe Fallback", () => {
    it("uses gemini-3.8-flash, redacts PII, never invents arbitrary 500 USDC drafts, and enforces limits", async () => {
      const sanitized = sanitizeForAi(
        `Pay alice@example.com or ${ALICE_ADDR} via +1 (555) 123-4567 for design`
      );
      assert.ok(!sanitized.includes("alice@example.com"));
      assert.ok(!sanitized.includes(ALICE_ADDR));
      assert.ok(!sanitized.includes("555"));
      assert.ok(sanitized.includes("[EMAIL_REDACTED]"));
      assert.ok(sanitized.includes("[STELLAR_ADDRESS_REDACTED]"));
      assert.ok(sanitized.includes("[PHONE_REDACTED]"));

      // Deterministic fallback must ask for clarification when amount or scope is absent
      const unclear1 = fallbackDraft("test", "WORK");
      assert.strictEqual(unclear1.result, "CLARIFICATION_REQUIRED");
      const unclear2 = fallbackDraft("pay freelancer for design work", "WORK");
      assert.strictEqual(unclear2.result, "CLARIFICATION_REQUIRED");

      // Only drafts when explicit amount and scope exist
      const clear = fallbackDraft("Pay 750 USDC for landing page design in 5 days", "WORK");
      assert.strictEqual(clear.result, "DRAFT_READY");
      if (clear.result === "DRAFT_READY") {
        assert.strictEqual(clear.amount, "750.00");
        assert.strictEqual(clear.asset, "USDC");
      }

      const srv = await startIsolatedServer({
        tempDir,
        aiRateLimitMax: 2,
        aiMaxInputChars: 100,
      });
      activeClosers.push(srv.close);

      const aliceToken = await loginSandbox(srv.baseUrl, "alice");

      const infoRes = await fetch(`${srv.baseUrl}/api/ai/info`, {
        headers: { Authorization: `Bearer ${aliceToken}` },
      });
      assert.strictEqual(infoRes.status, 200);
      const info = (await infoRes.json()) as any;
      assert.strictEqual(info.model, "gemini-3.8-flash");

      const tooLong = await fetch(`${srv.baseUrl}/api/ai/draft`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({ prompt: "a".repeat(150), transactionType: "WORK" }),
      });
      assert.strictEqual(tooLong.status, 400);

      const okDraft = await fetch(`${srv.baseUrl}/api/ai/draft`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({ prompt: "help me draft an agreement", transactionType: "WORK" }),
      });
      assert.strictEqual(okDraft.status, 200);
      const draftBody = (await okDraft.json()) as any;
      assert.strictEqual(draftBody.result, "CLARIFICATION_REQUIRED");

      // Rate limit exceeded on 3rd call
      const rateLimited = await fetch(`${srv.baseUrl}/api/ai/draft`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({ prompt: "test", transactionType: "WORK" }),
      });
      assert.strictEqual(rateLimited.status, 429);
    });
  });

  describe("5. Server-Side Privy Identity & Embedded Stellar Wallet Verification (Step 1)", () => {
    function createPrivyKeys(appId = "cm-privy-app-step1") {
      const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
        namedCurve: "P-256",
      });
      return {
        appId,
        appSecret: "super-secret-privy-key-do-not-leak",
        pubPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
        privPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      };
    }

    function issuePrivyToken(appId: string, sub: string, privPem: string) {
      const now = Math.floor(Date.now() / 1000);
      return signEs256Jwt({ iss: "privy.io", aud: appId, sub, exp: now + 300 }, privPem);
    }

    function readJsonFile(filePath: string): Record<string, any> {
      if (!fs.existsSync(filePath)) return {};
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, any>;
    }

    it("A/C. Verifies Privy REST API auth headers, accepts single embedded Stellar wallet, and supports omitted client stellarAddress", async () => {
      const keys = createPrivyKeys();
      const capturedRequests: Array<{ url: string; headers: Record<string, string> }> = [];

      const srv = await startIsolatedServer({
        tempDir,
        privyAppId: keys.appId,
        privyAppSecret: keys.appSecret,
        privyVerificationKey: keys.pubPem,
        fetchFn: (async (url: string, init?: RequestInit) => {
          if (url.startsWith("https://api.privy.io/v1/users/")) {
            const headersObj: Record<string, string> = {};
            if (init?.headers && typeof init.headers === "object" && !Array.isArray(init.headers)) {
              for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
                headersObj[k.toLowerCase()] = v;
              }
            }
            capturedRequests.push({ url, headers: headersObj });
            return new Response(
              JSON.stringify({
                id: "did:privy:alice-1",
                created_at: 1731974895,
                has_accepted_terms: true,
                is_guest: false,
                linked_accounts: [
                  {
                    type: "email",
                    address: "Alice.Verified@Example.com",
                    verified_at: 1731974895,
                    first_verified_at: 1731974895,
                    latest_verified_at: 1731974895,
                  },
                  {
                    type: "wallet",
                    id: "wlt-eth-1",
                    address: "0x7Ef5363308127128969618240eDcB9F8f61e90F6",
                    chain_type: "ethereum",
                    wallet_client_type: "metamask",
                    connector_type: "injected",
                    verified_at: 1731974895,
                  },
                  {
                    type: "wallet",
                    id: "wlt-stellar-1",
                    address: ALICE_ADDR,
                    chain_type: "stellar",
                    wallet_client_type: "privy",
                    wallet_client: "privy",
                    connector_type: "embedded",
                    imported: false,
                    delegated: false,
                    user_can_sign: true,
                    wallet_index: 0,
                    verified_at: 1731974895,
                  },
                ],
                mfa_methods: [],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response("{}", { status: 404 });
        }) as typeof fetch,
      });
      activeClosers.push(srv.close);

      const token = issuePrivyToken(keys.appId, "did:privy:alice-1", keys.privPem);

      // C: Client omits stellarAddress; backend uses authoritative Privy wallet
      const res = await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token }),
      });

      assert.strictEqual(res.status, 200);
      const body = (await res.json()) as any;
      assert.strictEqual(body.isNewUser, true);
      assert.ok(String(body.token).startsWith("tf-sess-"));
      assert.strictEqual(body.user.provider, "privy");
      assert.strictEqual(body.user.providerSubject, "did:privy:alice-1");
      assert.strictEqual(body.user.stellarAddress, ALICE_ADDR);
      assert.strictEqual(body.user.walletCustody, "privy_embedded");
      assert.strictEqual(body.user.email, "alice.verified@example.com");
      assert.strictEqual(body.wallet.address, ALICE_ADDR);
      assert.strictEqual(body.wallet.isEmbedded, true);

      // Verify exact Privy REST endpoint and auth headers
      assert.strictEqual(capturedRequests.length, 1);
      assert.strictEqual(capturedRequests[0].url, "https://api.privy.io/v1/users/did:privy:alice-1");
      assert.strictEqual(capturedRequests[0].headers["privy-app-id"], keys.appId);
      const expectedBasic = `Basic ${Buffer.from(`${keys.appId}:${keys.appSecret}`).toString("base64")}`;
      assert.strictEqual(capturedRequests[0].headers["authorization"], expectedBasic);
    });

    it("B. Rejects client wallet spoofing with 403 WALLET_OWNERSHIP_MISMATCH and creates no user or session", async () => {
      const keys = createPrivyKeys();
      const srv = await startIsolatedServer({
        tempDir,
        privyAppId: keys.appId,
        privyAppSecret: keys.appSecret,
        privyVerificationKey: keys.pubPem,
        fetchFn: (async (url: string) => {
          if (url === "https://api.privy.io/v1/users/did:privy:victim-or-user") {
            return new Response(
              JSON.stringify({
                id: "did:privy:victim-or-user",
                created_at: 1731974895,
                has_accepted_terms: true,
                is_guest: false,
                linked_accounts: [
                  {
                    type: "wallet",
                    address: ALICE_ADDR,
                    chain_type: "stellar",
                    wallet_client_type: "privy",
                    connector_type: "embedded",
                    verified_at: 1731974895,
                  },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response("{}", { status: 404 });
        }) as typeof fetch,
      });
      activeClosers.push(srv.close);

      const token = issuePrivyToken(keys.appId, "did:privy:victim-or-user", keys.privPem);
      const res = await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: token,
          stellarAddress: BOB_ADDR,
        }),
      });

      assert.strictEqual(res.status, 403);
      const body = (await res.json()) as any;
      assert.strictEqual(body.code, "WALLET_OWNERSHIP_MISMATCH");
      assert.strictEqual(body.token, undefined);

      // Verify zero user or session records persisted
      assert.deepStrictEqual(readJsonFile(path.join(tempDir, "users.json")), {});
      assert.deepStrictEqual(readJsonFile(path.join(tempDir, "sessions.json")), {});
    });

    it("D/E/F. Rejects missing, multiple, external-only, wrong-chain, and malformed Stellar wallet records", async () => {
      const keys = createPrivyKeys();
      let mockLinkedAccounts: unknown[] = [];

      const srv = await startIsolatedServer({
        tempDir,
        privyAppId: keys.appId,
        privyAppSecret: keys.appSecret,
        privyVerificationKey: keys.pubPem,
        fetchFn: (async (url: string) => {
          if (url === "https://api.privy.io/v1/users/did:privy:edge-cases") {
            return new Response(
              JSON.stringify({
                id: "did:privy:edge-cases",
                created_at: 1731974895,
                has_accepted_terms: true,
                is_guest: false,
                linked_accounts: mockLinkedAccounts,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response("{}", { status: 404 });
        }) as typeof fetch,
      });
      activeClosers.push(srv.close);

      const token = issuePrivyToken(keys.appId, "did:privy:edge-cases", keys.privPem);
      const runSync = async (stellarAddress?: string) =>
        fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: token, stellarAddress }),
        });

      // D1: No wallets at all
      mockLinkedAccounts = [{ type: "email", address: "u@example.com", verified_at: 1731974895 }];
      const noWalletRes = await runSync(ALICE_ADDR);
      assert.strictEqual(noWalletRes.status, 403);
      assert.strictEqual(((await noWalletRes.json()) as any).code, "NO_EMBEDDED_STELLAR_WALLET");

      // D2: External Stellar wallet only (e.g. Freighter injected)
      mockLinkedAccounts = [
        {
          type: "wallet",
          address: ALICE_ADDR,
          chain_type: "stellar",
          wallet_client_type: "freighter",
          connector_type: "injected",
          verified_at: 1731974895,
        },
      ];
      const externalOnlyRes = await runSync(ALICE_ADDR);
      assert.strictEqual(externalOnlyRes.status, 403);
      assert.strictEqual(((await externalOnlyRes.json()) as any).code, "NO_EMBEDDED_STELLAR_WALLET");

      // F1: Wrong chain type only (ethereum)
      mockLinkedAccounts = [
        {
          type: "wallet",
          address: "0x7Ef5363308127128969618240eDcB9F8f61e90F6",
          chain_type: "ethereum",
          wallet_client_type: "privy",
          connector_type: "embedded",
          verified_at: 1731974895,
        },
      ];
      const wrongChainRes = await runSync();
      assert.strictEqual(wrongChainRes.status, 403);
      assert.strictEqual(((await wrongChainRes.json()) as any).code, "NO_EMBEDDED_STELLAR_WALLET");

      // E: Multiple eligible embedded Stellar wallets
      mockLinkedAccounts = [
        {
          type: "wallet",
          address: ALICE_ADDR,
          chain_type: "stellar",
          wallet_client_type: "privy",
          connector_type: "embedded",
          verified_at: 1731974895,
        },
        {
          type: "wallet",
          address: BOB_ADDR,
          chain_type: "stellar",
          wallet_client_type: "privy",
          connector_type: "embedded",
          verified_at: 1731974896,
        },
      ];
      const multiRes = await runSync();
      assert.strictEqual(multiRes.status, 409);
      assert.strictEqual(((await multiRes.json()) as any).code, "MULTIPLE_EMBEDDED_STELLAR_WALLETS");

      // F2: Missing wallet address
      mockLinkedAccounts = [
        {
          type: "wallet",
          chain_type: "stellar",
          wallet_client_type: "privy",
          connector_type: "embedded",
        },
      ];
      const missingAddrRes = await runSync();
      assert.strictEqual(missingAddrRes.status, 502);
      assert.strictEqual(((await missingAddrRes.json()) as any).code, "INVALID_PRIVY_WALLET");

      // F3: Invalid Stellar StrKey
      mockLinkedAccounts = [
        {
          type: "wallet",
          address: "GNOTAVALIDSTELLARADDRESS1234567890",
          chain_type: "stellar",
          wallet_client_type: "privy",
          connector_type: "embedded",
        },
      ];
      const invalidKeyRes = await runSync();
      assert.strictEqual(invalidKeyRes.status, 400);
      assert.strictEqual(((await invalidKeyRes.json()) as any).code, "INVALID_STELLAR_ADDRESS");

      // F4: External wallet presented as embedded (contradictory metadata)
      mockLinkedAccounts = [
        {
          type: "wallet",
          address: ALICE_ADDR,
          chain_type: "stellar",
          wallet_client_type: "privy",
          connector_type: "injected",
        },
      ];
      const fakeEmbedded1 = await runSync();
      assert.strictEqual(fakeEmbedded1.status, 502);
      assert.strictEqual(((await fakeEmbedded1.json()) as any).code, "INVALID_PRIVY_WALLET");

      mockLinkedAccounts = [
        {
          type: "wallet",
          address: ALICE_ADDR,
          chain_type: "stellar",
          wallet_client_type: "privy",
          wallet_client: "unknown",
          connector_type: "embedded",
        },
      ];
      const fakeEmbedded2 = await runSync();
      assert.strictEqual(fakeEmbedded2.status, 502);
      assert.strictEqual(((await fakeEmbedded2.json()) as any).code, "INVALID_PRIVY_WALLET");

      // F5: Incomplete linked-account record (missing chain_type)
      mockLinkedAccounts = [
        {
          type: "wallet",
          address: ALICE_ADDR,
        },
      ];
      const incompleteRes = await runSync();
      assert.strictEqual(incompleteRes.status, 502);
      assert.strictEqual(((await incompleteRes.json()) as any).code, "PRIVY_RESPONSE_INVALID");

      assert.deepStrictEqual(readJsonFile(path.join(tempDir, "users.json")), {});
      assert.deepStrictEqual(readJsonFile(path.join(tempDir, "sessions.json")), {});
    });

    it("G/H. Uses authoritative verified email and display name only; ignores unverified emails and client-supplied profile fields", async () => {
      const keys = createPrivyKeys();
      let currentSub = "did:privy:user-unverified-email";
      const responsesBySub: Record<string, Record<string, unknown>> = {
        "did:privy:user-unverified-email": {
          id: "did:privy:user-unverified-email",
          linked_accounts: [
            {
              type: "email",
              address: "unverified@example.com",
              verified_at: null,
            },
            {
              type: "wallet",
              address: ALICE_ADDR,
              chain_type: "stellar",
              wallet_client_type: "privy",
              connector_type: "embedded",
            },
          ],
        },
        "did:privy:user-google-verified": {
          id: "did:privy:user-google-verified",
          linked_accounts: [
            {
              type: "google_oauth",
              subject: "g-123",
              email: "Verified.Google@Example.com",
              name: "Jane Authoritative",
              verified_at: 1731974895,
            },
            {
              type: "wallet",
              address: BOB_ADDR,
              chain_type: "stellar",
              wallet_client_type: "privy",
              connector_type: "embedded",
            },
          ],
        },
      };

      const srv = await startIsolatedServer({
        tempDir,
        privyAppId: keys.appId,
        privyAppSecret: keys.appSecret,
        privyVerificationKey: keys.pubPem,
        fetchFn: (async (url: string) => {
          const prefix = "https://api.privy.io/v1/users/";
          if (url.startsWith(prefix)) {
            const sub = url.slice(prefix.length);
            if (responsesBySub[sub]) {
              return new Response(JSON.stringify(responsesBySub[sub]), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              });
            }
          }
          return new Response("{}", { status: 404 });
        }) as typeof fetch,
      });
      activeClosers.push(srv.close);

      // Case 1: Unverified email -> email stays null, client email/displayName ignored, fallback "Privy User"
      const token1 = issuePrivyToken(keys.appId, currentSub, keys.privPem);
      const res1 = await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: token1,
          email: "spoofed@attacker.com",
          displayName: "Spoofed Name",
        }),
      });
      assert.strictEqual(res1.status, 200);
      const body1 = (await res1.json()) as any;
      assert.strictEqual(body1.user.email, null);
      assert.strictEqual(body1.user.displayName, "Privy User");

      // Case 2: Verified Google OAuth -> authoritative email & displayName retained, client fields ignored
      currentSub = "did:privy:user-google-verified";
      const token2 = issuePrivyToken(keys.appId, currentSub, keys.privPem);
      const res2 = await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: token2,
          email: "spoofed@attacker.com",
          displayName: "Attacker Override",
        }),
      });
      assert.strictEqual(res2.status, 200);
      const body2 = (await res2.json()) as any;
      assert.strictEqual(body2.user.email, "verified.google@example.com");
      assert.strictEqual(body2.user.displayName, "Jane Authoritative");
    });

    it("I. Fails closed across Privy API HTTP errors, network failures, timeouts, invalid JSON, and bad schemas without leaking secrets", async () => {
      const keys = createPrivyKeys();
      type FailureMode =
        | "401"
        | "403"
        | "404"
        | "429"
        | "500"
        | "network"
        | "timeout"
        | "bad_json"
        | "bad_schema"
        | "sub_mismatch";
      let mode: FailureMode = "401";

      const srv = await startIsolatedServer({
        tempDir,
        privyAppId: keys.appId,
        privyAppSecret: keys.appSecret,
        privyVerificationKey: keys.pubPem,
        privyApiTimeoutMs: 40,
        fetchFn: (async () => {
          switch (mode) {
            case "401":
              return new Response("Unauthorized", { status: 401 });
            case "403":
              return new Response("Forbidden", { status: 403 });
            case "404":
              return new Response("Not Found", { status: 404 });
            case "429":
              return new Response("Too Many Requests", { status: 429 });
            case "500":
              return new Response("Internal Server Error", { status: 500 });
            case "network":
              throw new Error(`ECONNREFUSED with secret ${keys.appSecret}`);
            case "timeout":
              return new Promise<Response>(() => {});
            case "bad_json":
              return new Response("{not-json", { status: 200 });
            case "bad_schema":
              return new Response(JSON.stringify({ id: "did:privy:fail-cases" }), { status: 200 });
            case "sub_mismatch":
              return new Response(
                JSON.stringify({
                  id: "did:privy:someone-else",
                  linked_accounts: [
                    {
                      type: "wallet",
                      address: ALICE_ADDR,
                      chain_type: "stellar",
                      wallet_client_type: "privy",
                      connector_type: "embedded",
                    },
                  ],
                }),
                { status: 200 }
              );
          }
        }) as typeof fetch,
      });
      activeClosers.push(srv.close);

      const token = issuePrivyToken(keys.appId, "did:privy:fail-cases", keys.privPem);

      const expectations: Array<[FailureMode, number, string]> = [
        ["401", 502, "PRIVY_API_AUTH_FAILED"],
        ["403", 502, "PRIVY_API_AUTH_FAILED"],
        ["404", 404, "PRIVY_USER_NOT_FOUND"],
        ["429", 503, "PRIVY_API_RATE_LIMITED"],
        ["500", 502, "PRIVY_LOOKUP_FAILED"],
        ["network", 502, "PRIVY_API_UNAVAILABLE"],
        ["timeout", 504, "PRIVY_API_TIMEOUT"],
        ["bad_json", 502, "PRIVY_RESPONSE_INVALID"],
        ["bad_schema", 502, "PRIVY_RESPONSE_INVALID"],
        ["sub_mismatch", 502, "PRIVY_IDENTITY_MISMATCH"],
      ];

      for (const [m, expectedStatus, expectedCode] of expectations) {
        mode = m;
        const res = await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: token, stellarAddress: ALICE_ADDR }),
        });
        assert.strictEqual(res.status, expectedStatus, `Mode ${m} expected status ${expectedStatus}`);
        const rawText = await res.text();
        assert.ok(!rawText.includes(keys.appSecret), `Mode ${m} must never leak appSecret`);
        assert.ok(!rawText.includes(token), `Mode ${m} must never leak accessToken`);
        const parsed = JSON.parse(rawText) as any;
        assert.strictEqual(parsed.code, expectedCode, `Mode ${m} expected code ${expectedCode}`);
      }

      assert.deepStrictEqual(readJsonFile(path.join(tempDir, "users.json")), {});
      assert.deepStrictEqual(readJsonFile(path.join(tempDir, "sessions.json")), {});
    });

    it("J. Fails closed when PRIVY_APP_SECRET or PRIVY_APP_ID is missing without breaking standalone email OTP", async () => {
      const keys = createPrivyKeys();
      const token = issuePrivyToken(keys.appId, "did:privy:cred-test", keys.privPem);

      // Production missing PRIVY_APP_SECRET
      const prodNoSecret = await startIsolatedServer({
        tempDir,
        isProd: true,
        allowDevSandbox: false,
        privyAppId: keys.appId,
        privyAppSecret: null,
        privyVerificationKey: keys.pubPem,
      });
      activeClosers.push(prodNoSecret.close);

      const resProdNoSecret = await fetch(`${prodNoSecret.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token, stellarAddress: ALICE_ADDR }),
      });
      assert.strictEqual(resProdNoSecret.status, 503);
      assert.strictEqual(((await resProdNoSecret.json()) as any).code, "PRIVY_CREDENTIALS_MISSING");

      // Production missing PRIVY_APP_ID
      const prodNoAppId = await startIsolatedServer({
        tempDir: fs.mkdtempSync(path.join(os.tmpdir(), "trustflow-prod-no-appid-")),
        isProd: true,
        allowDevSandbox: false,
        privyAppId: null,
        privyAppSecret: keys.appSecret,
      });
      activeClosers.push(prodNoAppId.close);

      const resProdNoAppId = await fetch(`${prodNoAppId.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token, stellarAddress: ALICE_ADDR }),
      });
      assert.strictEqual(resProdNoAppId.status, 503);
      assert.strictEqual(((await resProdNoAppId.json()) as any).code, "PRIVY_AUTH_UNAVAILABLE");

      // Development missing PRIVY_APP_SECRET also fails closed (never falls back to client body)
      // AND standalone email OTP still works when Privy credentials are absent
      const sentCodes: string[] = [];
      const devNoSecret = await startIsolatedServer({
        tempDir: fs.mkdtempSync(path.join(os.tmpdir(), "trustflow-dev-no-secret-")),
        isProd: false,
        privyAppId: keys.appId,
        privyAppSecret: null,
        privyVerificationKey: keys.pubPem,
        otpDelivery: {
          isConfigured: () => true,
          async sendOtp(_email, code) {
            sentCodes.push(code);
          },
        },
      });
      activeClosers.push(devNoSecret.close);

      const resDevNoSecret = await fetch(`${devNoSecret.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token, stellarAddress: ALICE_ADDR }),
      });
      assert.strictEqual(resDevNoSecret.status, 503);
      assert.strictEqual(((await resDevNoSecret.json()) as any).code, "PRIVY_CREDENTIALS_MISSING");

      // Standalone email OTP remains functional
      const otpStart = await fetch(`${devNoSecret.baseUrl}/api/auth/otp/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "standalone@example.com" }),
      });
      assert.strictEqual(otpStart.status, 200);
      const otpVerify = await fetch(`${devNoSecret.baseUrl}/api/auth/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "standalone@example.com", code: sentCodes[0] }),
      });
      assert.strictEqual(otpVerify.status, 200);
    });

    it("K. Preserves existing account integrity, wallet uniqueness, immutability, and prevents cross-provider email merge", async () => {
      const keys = createPrivyKeys();
      const sentCodes: string[] = [];
      const privyRecords: Record<string, { wallet: string; email: string | null; name: string | null }> = {
        "did:privy:existing-user": {
          wallet: ALICE_ADDR,
          email: "shared@example.com",
          name: "Alice Privy",
        },
        "did:privy:collision-user": {
          wallet: ALICE_ADDR,
          email: "other@example.com",
          name: "Collision User",
        },
      };

      const srv = await startIsolatedServer({
        tempDir,
        privyAppId: keys.appId,
        privyAppSecret: keys.appSecret,
        privyVerificationKey: keys.pubPem,
        otpDelivery: {
          isConfigured: () => true,
          async sendOtp(_email, code) {
            sentCodes.push(code);
          },
        },
        fetchFn: (async (url: string) => {
          const prefix = "https://api.privy.io/v1/users/";
          if (url.startsWith(prefix)) {
            const sub = url.slice(prefix.length);
            const rec = privyRecords[sub];
            if (rec) {
              const accounts: Record<string, unknown>[] = [
                {
                  type: "wallet",
                  address: rec.wallet,
                  chain_type: "stellar",
                  wallet_client_type: "privy",
                  connector_type: "embedded",
                },
              ];
              if (rec.email) {
                accounts.push({ type: "email", address: rec.email, verified_at: 1731974895 });
              }
              if (rec.name) {
                accounts.push({
                  type: "google_oauth",
                  subject: "g-sub",
                  email: rec.email || "g@example.com",
                  name: rec.name,
                  verified_at: 1731974895,
                });
              }
              return new Response(
                JSON.stringify({ id: sub, linked_accounts: accounts }),
                { status: 200, headers: { "Content-Type": "application/json" } }
              );
            }
          }
          return new Response("{}", { status: 404 });
        }) as typeof fetch,
      });
      activeClosers.push(srv.close);

      // 1. Create a standalone email_otp account with shared@example.com
      await fetch(`${srv.baseUrl}/api/auth/otp/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "shared@example.com" }),
      });
      const otpRes = await fetch(`${srv.baseUrl}/api/auth/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "shared@example.com", code: sentCodes[0] }),
      });
      const otpUser = ((await otpRes.json()) as any).user;

      // 2. Privy login with same verified email creates a SEPARATE privy user (no email merge)
      const tokenExisting = issuePrivyToken(keys.appId, "did:privy:existing-user", keys.privPem);
      const firstPrivy = await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: tokenExisting }),
      });
      assert.strictEqual(firstPrivy.status, 200);
      const firstBody = (await firstPrivy.json()) as any;
      assert.strictEqual(firstBody.isNewUser, true);
      assert.notStrictEqual(firstBody.user.id, otpUser.id);
      assert.strictEqual(firstBody.user.provider, "privy");

      // 3. Repeat Privy login matches existing user, and unverified client profile data cannot overwrite it
      privyRecords["did:privy:existing-user"].name = null;
      privyRecords["did:privy:existing-user"].email = null;
      const repeatPrivy = await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: tokenExisting,
          email: "evil-overwrite@example.com",
          displayName: "Evil Overwrite",
        }),
      });
      assert.strictEqual(repeatPrivy.status, 200);
      const repeatBody = (await repeatPrivy.json()) as any;
      assert.strictEqual(repeatBody.isNewUser, false);
      assert.strictEqual(repeatBody.user.id, firstBody.user.id);
      assert.strictEqual(repeatBody.user.email, "shared@example.com");
      assert.strictEqual(repeatBody.user.displayName, "Alice Privy");

      // 4. Different Privy DID claiming the same wallet address is rejected with 409 WALLET_ALREADY_LINKED
      const tokenCollision = issuePrivyToken(keys.appId, "did:privy:collision-user", keys.privPem);
      const collisionRes = await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: tokenCollision }),
      });
      assert.strictEqual(collisionRes.status, 409);
      assert.strictEqual(((await collisionRes.json()) as any).code, "WALLET_ALREADY_LINKED");
    });

    it("L. Agreement authorization regression: attacker cannot spoof counterparty stellarAddress via privy-sync to access or accept an agreement", async () => {
      const keys = createPrivyKeys();

      const srv = await startIsolatedServer({
        tempDir,
        privyAppId: keys.appId,
        privyAppSecret: keys.appSecret,
        privyVerificationKey: keys.pubPem,
        fetchFn: (async (url: string) => {
          if (url === "https://api.privy.io/v1/users/did:privy:attacker") {
            return new Response(
              JSON.stringify({
                id: "did:privy:attacker",
                linked_accounts: [
                  {
                    type: "wallet",
                    address: CHARLIE_ADDR,
                    chain_type: "stellar",
                    wallet_client_type: "privy",
                    connector_type: "embedded",
                  },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response("{}", { status: 404 });
        }) as typeof fetch,
      });
      activeClosers.push(srv.close);

      // Alice creates an agreement with Bob as recipient and Alice as approver (Charlie is an outsider)
      const aliceToken = await loginSandbox(srv.baseUrl, "alice");
      const createRes = await fetch(`${srv.baseUrl}/api/agreements`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({
          transactionType: "WORK",
          terms: {
            amount: "500.00",
            asset: "USDC",
            payer: ALICE_ADDR,
            recipient: BOB_ADDR,
            approver: ALICE_ADDR,
            title: "Protected Milestone",
            description: "Deliver production backend",
            deliverables: ["API endpoints"],
            condition: "Payer approves delivery",
            cancellationTerms: "Mutual agreement",
            deadline: "2026-12-20T00:00:00.000Z",
            contractId: "PENDING_TRUSTLESS_WORK_INTEGRATION",
            domain: "trustflow.stellar.escrow.v1",
            network: "testnet",
            version: 1,
          },
        }),
      });
      assert.strictEqual(createRes.status, 201);
      const agreement = (await createRes.json()) as AgreementRecord;

      // Attacker attempts privy-sync spoofing BOB_ADDR (the agreement recipient)
      const attackerJwt = issuePrivyToken(keys.appId, "did:privy:attacker", keys.privPem);
      const spoofSyncRes = await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: attackerJwt,
          stellarAddress: BOB_ADDR,
        }),
      });
      assert.strictEqual(spoofSyncRes.status, 403);
      assert.strictEqual(((await spoofSyncRes.json()) as any).code, "WALLET_OWNERSHIP_MISMATCH");

      // Even if attacker completes legitimate privy-sync, they receive only CHARLIE_ADDR and cannot read or accept Bob's agreement
      const realSyncRes = await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: attackerJwt }),
      });
      assert.strictEqual(realSyncRes.status, 200);
      const attackerSession = (await realSyncRes.json()) as any;
      assert.strictEqual(attackerSession.user.stellarAddress, CHARLIE_ADDR);

      const getAgreementRes = await fetch(`${srv.baseUrl}/api/agreements/${agreement.id}`, {
        headers: { Authorization: `Bearer ${attackerSession.token}` },
      });
      assert.strictEqual(getAgreementRes.status, 403);

      const acceptRes = await fetch(`${srv.baseUrl}/api/agreements/${agreement.id}/accept`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${attackerSession.token}`,
        },
        body: JSON.stringify({
          role: "RECIPIENT",
          canonicalHash: agreement.canonicalHash,
        }),
      });
      assert.strictEqual(acceptRes.status, 403);
    });

    it("M. Atomic privy-sync: concurrent requests for the same new Privy subject create exactly one UserRecord and valid sessions", async () => {
      const keys = createPrivyKeys();
      const targetSub = "did:privy:concurrent-same-sub";

      const srv = await startIsolatedServer({
        tempDir,
        privyAppId: keys.appId,
        privyAppSecret: keys.appSecret,
        privyVerificationKey: keys.pubPem,
        fetchFn: (async (url: string) => {
          if (url === `https://api.privy.io/v1/users/${encodeURIComponent(targetSub)}` ||
              url === `https://api.privy.io/v1/users/${targetSub}`) {
            // Brief async yield so all concurrent Privy lookups overlap before upsert
            await new Promise((resolve) => setTimeout(resolve, 25));
            return new Response(
              JSON.stringify({
                id: targetSub,
                linked_accounts: [
                  {
                    type: "email",
                    address: "concurrent@example.com",
                    verified_at: 1731974895,
                  },
                  {
                    type: "wallet",
                    address: ALICE_ADDR,
                    chain_type: "stellar",
                    wallet_client_type: "privy",
                    connector_type: "embedded",
                    verified_at: 1731974895,
                  },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response("{}", { status: 404 });
        }) as typeof fetch,
      });
      activeClosers.push(srv.close);

      const jwt = issuePrivyToken(keys.appId, targetSub, keys.privPem);
      const responses = await Promise.all(
        Array.from({ length: 4 }, () =>
          fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accessToken: jwt, stellarAddress: ALICE_ADDR }),
          })
        )
      );

      for (const res of responses) {
        assert.strictEqual(res.status, 200);
      }
      const payloads = (await Promise.all(responses.map((r) => r.json()))) as Array<{
        token: string;
        user: { id: string; providerSubject: string; stellarAddress: string };
        isNewUser: boolean;
      }>;

      const userIds = new Set(payloads.map((p) => p.user.id));
      assert.strictEqual(userIds.size, 1, "All concurrent requests must return the exact same user.id");

      const newUserCount = payloads.filter((p) => p.isNewUser === true).length;
      const existingUserCount = payloads.filter((p) => p.isNewUser === false).length;
      assert.strictEqual(newUserCount, 1, "Exactly one concurrent response must report isNewUser: true");
      assert.strictEqual(existingUserCount, 3, "Remaining concurrent responses must report isNewUser: false");

      const usersMap = readJsonFile(path.join(tempDir, "users.json"));
      const matchingUsers = Object.values(usersMap).filter(
        (u: any) => u.provider === "privy" && u.providerSubject === targetSub
      );
      assert.strictEqual(matchingUsers.length, 1, "users.json must contain exactly one UserRecord");

      for (const payload of payloads) {
        const meRes = await fetch(`${srv.baseUrl}/api/auth/me`, {
          headers: { Authorization: `Bearer ${payload.token}` },
        });
        assert.strictEqual(meRes.status, 200);
        const meBody = (await meRes.json()) as { user: { id: string } | null };
        assert.strictEqual(meBody.user?.id, payloads[0].user.id);
      }
    });

    it("N. Atomic privy-sync: concurrent requests from different Privy subjects claiming the same Stellar wallet yield one success and one 409 WALLET_ALREADY_LINKED", async () => {
      const keys = createPrivyKeys();
      const subA = "did:privy:race-wallet-a";
      const subB = "did:privy:race-wallet-b";

      const srv = await startIsolatedServer({
        tempDir,
        privyAppId: keys.appId,
        privyAppSecret: keys.appSecret,
        privyVerificationKey: keys.pubPem,
        fetchFn: (async (url: string) => {
          const prefix = "https://api.privy.io/v1/users/";
          if (url.startsWith(prefix)) {
            const sub = decodeURIComponent(url.slice(prefix.length));
            if (sub === subA || sub === subB) {
              await new Promise((resolve) => setTimeout(resolve, 25));
              return new Response(
                JSON.stringify({
                  id: sub,
                  linked_accounts: [
                    {
                      type: "wallet",
                      address: BOB_ADDR,
                      chain_type: "stellar",
                      wallet_client_type: "privy",
                      connector_type: "embedded",
                      verified_at: 1731974895,
                    },
                  ],
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
              );
            }
          }
          return new Response("{}", { status: 404 });
        }) as typeof fetch,
      });
      activeClosers.push(srv.close);

      const jwtA = issuePrivyToken(keys.appId, subA, keys.privPem);
      const jwtB = issuePrivyToken(keys.appId, subB, keys.privPem);

      const [resA, resB] = await Promise.all([
        fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: jwtA }),
        }).then(async (r) => ({ sub: subA, status: r.status, body: (await r.json()) as any })),
        fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: jwtB }),
        }).then(async (r) => ({ sub: subB, status: r.status, body: (await r.json()) as any })),
      ]);

      const outcomes = [resA, resB];
      const winners = outcomes.filter((o) => o.status === 200);
      const conflicts = outcomes.filter((o) => o.status === 409);

      assert.strictEqual(winners.length, 1, "Exactly one concurrent claimant must succeed");
      assert.strictEqual(conflicts.length, 1, "Exactly one concurrent claimant must receive 409");
      assert.strictEqual(conflicts[0].body.code, "WALLET_ALREADY_LINKED");
      assert.strictEqual(winners[0].body.user.stellarAddress, BOB_ADDR);

      const usersMap = readJsonFile(path.join(tempDir, "users.json"));
      const walletOwners = Object.values(usersMap).filter((u: any) => u.stellarAddress === BOB_ADDR);
      assert.strictEqual(walletOwners.length, 1, "Exactly one UserRecord may own the Stellar wallet");
      assert.strictEqual((walletOwners[0] as any).providerSubject, winners[0].sub);

      const meRes = await fetch(`${srv.baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${winners[0].body.token}` },
      });
      assert.strictEqual(meRes.status, 200);
      assert.strictEqual(((await meRes.json()) as any).user?.id, winners[0].body.user.id);
    });

    it("O. Atomic privy-sync: preserves existing UserRecord fields, retains id/createdAt on return, and enforces wallet immutability", async () => {
      const keys = createPrivyKeys();
      const targetSub = "did:privy:preserve-fields-user";
      let upstreamWallet = ALICE_ADDR;

      // Seed existing Privy user in users.json with custom avatar, original createdAt, and extra persisted metadata
      const originalCreatedAt = "2025-01-15T10:00:00.000Z";
      const seededUserId = "usr-seeded-privy-123";
      fs.writeFileSync(
        path.join(tempDir, "users.json"),
        JSON.stringify(
          {
            [seededUserId]: {
              id: seededUserId,
              email: "existing@example.com",
              displayName: "Original Display",
              avatar: "🛡️",
              provider: "privy",
              authVerified: true,
              providerSubject: targetSub,
              stellarAddress: ALICE_ADDR,
              walletCustody: "privy_embedded",
              isSandbox: false,
              createdAt: originalCreatedAt,
              lastLoginAt: "2025-01-16T00:00:00.000Z",
              customMetadata: { tier: "beta", notes: "preserve-me" },
            },
          },
          null,
          2
        ),
        "utf-8"
      );

      const srv = await startIsolatedServer({
        tempDir,
        privyAppId: keys.appId,
        privyAppSecret: keys.appSecret,
        privyVerificationKey: keys.pubPem,
        fetchFn: (async (url: string) => {
          if (url === `https://api.privy.io/v1/users/${targetSub}`) {
            return new Response(
              JSON.stringify({
                id: targetSub,
                linked_accounts: [
                  {
                    type: "wallet",
                    address: upstreamWallet,
                    chain_type: "stellar",
                    wallet_client_type: "privy",
                    connector_type: "embedded",
                    verified_at: 1731974895,
                  },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response("{}", { status: 404 });
        }) as typeof fetch,
      });
      activeClosers.push(srv.close);

      const jwt = issuePrivyToken(keys.appId, targetSub, keys.privPem);
      const returningRes = await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: jwt }),
      });
      assert.strictEqual(returningRes.status, 200);
      const returningBody = (await returningRes.json()) as any;
      assert.strictEqual(returningBody.isNewUser, false);
      assert.strictEqual(returningBody.user.id, seededUserId);
      assert.strictEqual(returningBody.user.createdAt, originalCreatedAt);
      assert.strictEqual(returningBody.user.avatar, "🛡️");
      assert.strictEqual(returningBody.user.email, "existing@example.com");
      assert.strictEqual(returningBody.user.displayName, "Original Display");
      assert.deepStrictEqual(returningBody.user.customMetadata, { tier: "beta", notes: "preserve-me" });
      assert.notStrictEqual(returningBody.user.lastLoginAt, "2025-01-16T00:00:00.000Z");

      const persistedAfterReturn = readJsonFile(path.join(tempDir, "users.json"));
      assert.strictEqual(Object.keys(persistedAfterReturn).length, 1);
      assert.deepStrictEqual(persistedAfterReturn[seededUserId].customMetadata, {
        tier: "beta",
        notes: "preserve-me",
      });

      // Attempt to change bound Stellar wallet for existing user -> 409 WALLET_IMMUTABLE, disk unchanged
      upstreamWallet = BOB_ADDR;
      const immutableRes = await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: jwt }),
      });
      assert.strictEqual(immutableRes.status, 409);
      assert.strictEqual(((await immutableRes.json()) as any).code, "WALLET_IMMUTABLE");

      const persistedAfterConflict = readJsonFile(path.join(tempDir, "users.json"));
      assert.strictEqual(persistedAfterConflict[seededUserId].stellarAddress, ALICE_ADDR);
    });

    it("P. Atomic privy-sync: session-save failure followed by retry reuses the same UserRecord without creating duplicates", async () => {
      const keys = createPrivyKeys();
      const targetSub = "did:privy:session-fail-retry";
      const realRepo = new FileAuthRepository(tempDir);
      let failNextSessionSave = true;

      const wrappedRepo: AuthRepository = {
        findUserById: (id) => realRepo.findUserById(id),
        findUserByEmail: (email) => realRepo.findUserByEmail(email),
        findUserByProviderSubject: (provider, subject) =>
          realRepo.findUserByProviderSubject(provider, subject),
        findUserByWalletAddress: (address) => realRepo.findUserByWalletAddress(address),
        saveUser: (user) => realRepo.saveUser(user),
        upsertPrivyUser: (params) => realRepo.upsertPrivyUser(params),
        saveSession: async (session) => {
          if (failNextSessionSave) {
            failNextSessionSave = false;
            throw new Error("Simulated transient session store failure");
          }
          return realRepo.saveSession(session);
        },
        findSession: (token) => realRepo.findSession(token),
        deleteSession: (token) => realRepo.deleteSession(token),
        saveOtp: (email, record) => realRepo.saveOtp(email, record),
        findOtp: (email) => realRepo.findOtp(email),
        deleteOtp: (email) => realRepo.deleteOtp(email),
      };

      const cfg = getRuntimeConfig({ dataDir: tempDir, allowDevSandbox: true });
      cfg.auth.privyAppId = keys.appId;
      cfg.auth.privyAppSecret = keys.appSecret;
      cfg.auth.privyVerificationKey = keys.pubPem;

      const backend = createBackendApp({
        config: cfg,
        authRepo: wrappedRepo,
        fetchFn: (async (url: string) => {
          if (url === `https://api.privy.io/v1/users/${targetSub}`) {
            return new Response(
              JSON.stringify({
                id: targetSub,
                linked_accounts: [
                  {
                    type: "email",
                    address: "retry@example.com",
                    verified_at: 1731974895,
                  },
                  {
                    type: "wallet",
                    address: CHARLIE_ADDR,
                    chain_type: "stellar",
                    wallet_client_type: "privy",
                    connector_type: "embedded",
                    verified_at: 1731974895,
                  },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response("{}", { status: 404 });
        }) as typeof fetch,
      });

      const server = http.createServer(backend.app);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      const addr = server.address() as { port: number };
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      activeClosers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));

      const jwt = issuePrivyToken(keys.appId, targetSub, keys.privPem);

      // 1. First sync commits user record but fails during session persistence
      const firstRes = await fetch(`${baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: jwt }),
      });
      assert.strictEqual(firstRes.status, 500);

      const usersAfterFail = readJsonFile(path.join(tempDir, "users.json"));
      const sessionsAfterFail = readJsonFile(path.join(tempDir, "sessions.json"));
      assert.strictEqual(Object.keys(usersAfterFail).length, 1);
      assert.strictEqual(Object.keys(sessionsAfterFail).length, 0);
      const persistedUserId = Object.keys(usersAfterFail)[0];

      // 2. Retry succeeds, reuses the exact committed user, and creates one valid session
      const retryRes = await fetch(`${baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: jwt }),
      });
      assert.strictEqual(retryRes.status, 200);
      const retryBody = (await retryRes.json()) as any;
      assert.strictEqual(retryBody.isNewUser, false);
      assert.strictEqual(retryBody.user.id, persistedUserId);

      const usersAfterRetry = readJsonFile(path.join(tempDir, "users.json"));
      const sessionsAfterRetry = readJsonFile(path.join(tempDir, "sessions.json"));
      assert.strictEqual(Object.keys(usersAfterRetry).length, 1);
      assert.strictEqual(Object.keys(sessionsAfterRetry).length, 1);

      const meRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${retryBody.token}` },
      });
      assert.strictEqual(meRes.status, 200);
      const meBody = (await meRes.json()) as any;
      assert.strictEqual(meBody.user?.id, persistedUserId);
      assert.strictEqual(meBody.wallet?.address, CHARLIE_ADDR);
    });
  });
});
