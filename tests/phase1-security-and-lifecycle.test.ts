import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { createBackendApp } from "../backend/src/index";
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
  googleClientId?: string | null;
  privyAppId?: string | null;
  privyVerificationKey?: string | null;
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

  baseCfg.auth.googleClientId = options.googleClientId ?? null;
  baseCfg.auth.privyAppId = options.privyAppId ?? null;
  baseCfg.auth.privyVerificationKey = options.privyVerificationKey ?? null;
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

      const srv = await startIsolatedServer({
        tempDir,
        privyAppId,
        privyVerificationKey: pubPem,
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

      // Valid login binds ALICE_ADDR once
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

      // Re-authenticating with a DIFFERENT stellarAddress is rejected (409 WALLET_IMMUTABLE)
      const hijackRes = await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: validPrivyJwt,
          stellarAddress: BOB_ADDR,
        }),
      });
      assert.strictEqual(hijackRes.status, 409);
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
});
