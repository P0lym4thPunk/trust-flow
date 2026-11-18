import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { Keypair } from "@stellar/stellar-sdk";
import { createBackendApp } from "../backend/src/index";
import { getRuntimeConfig } from "../backend/src/config/runtime.config";
import {
  FileAuthRepository,
  normalizeUserWallets,
} from "../backend/src/repositories/auth.repository";
import type { OtpDeliveryProvider } from "../backend/src/services/auth.service";
import type { WalletChallengeRecord } from "../backend/src/types/backend.types";
import {
  TrustFlowAuthController,
  createMemoryAuthStorage,
  AUTH_TOKEN_STORAGE_KEY,
  type PrivyUserLike,
} from "../src/lib/auth/privyLifecycle";
import type { FreighterBridgeLike } from "../src/lib/stellar/wallet";

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf-8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signEs256Jwt(
  payload: Record<string, unknown>,
  privateKeyPem: string,
  kid = "privy-test-ec-kid-1"
): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "ES256", typ: "JWT", kid }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.sign("sha256", Buffer.from(`${header}.${body}`, "utf-8"), {
    key: privateKeyPem,
    dsaEncoding: "ieee-p1363",
  });
  return `${header}.${body}.${base64UrlEncode(sig)}`;
}

function makePrivyApiWallet(address: string, overrides: Record<string, unknown> = {}) {
  return {
    type: "wallet",
    address,
    chain_type: "stellar",
    wallet_client_type: "privy",
    connector_type: "embedded",
    verified_at: 1760000000,
    ...overrides,
  };
}

function makeClientPrivyWallet(address: string, overrides: Record<string, unknown> = {}) {
  return {
    type: "wallet",
    address,
    chainType: "stellar",
    walletClientType: "privy",
    connectorType: "embedded",
    ...overrides,
  };
}

function readJsonFile(filePath: string): Record<string, any> {
  if (!fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, any>;
}

async function startMilestoneServer(options: {
  tempDir: string;
  isProd?: boolean;
  allowDevSandbox?: boolean;
  privyAppId?: string;
  privyAppSecret?: string;
  privyVerificationKey?: string | null;
  otpDelivery?: OtpDeliveryProvider;
  googleClientId?: string | null;
  fetchFn?: typeof fetch;
}) {
  const cfg = getRuntimeConfig({
    dataDir: options.tempDir,
    allowDevSandbox: options.allowDevSandbox ?? !(options.isProd ?? false),
  });
  cfg.isProd = options.isProd ?? false;
  cfg.nodeEnv = cfg.isProd ? "production" : "development";
  cfg.auth.privyAppId = options.privyAppId ?? "cm_app_milestone1_test";
  cfg.auth.privyAppSecret = options.privyAppSecret ?? "privy-secret-milestone1";
  cfg.auth.privyVerificationKey = options.privyVerificationKey ?? null;
  cfg.auth.googleClientId = options.googleClientId ?? null;

  const backend = createBackendApp({
    config: cfg,
    otpDelivery: options.otpDelivery,
    fetchFn: options.fetchFn,
  });

  const server = http.createServer(backend.app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    cfg,
    backend,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("TrustFlow Milestone 1: Comprehensive Authentication, Provisioning, Multi-Wallet & Lifecycle", () => {
  let tempDir: string;
  let ecPrivateKeyPem: string;
  let ecPublicKeyPem: string;
  const activeClosers: Array<() => Promise<void>> = [];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trustflow-m1-"));
    const ecKeys = crypto.generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    ecPrivateKeyPem = ecKeys.privateKey;
    ecPublicKeyPem = ecKeys.publicKey;
  });

  afterEach(async () => {
    while (activeClosers.length > 0) {
      const close = activeClosers.pop()!;
      await close();
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("Step 1: Privy-Only Production Cutover & Cross-Provider Identity Safety", () => {
    it("Production disables legacy OTP/Google routes (410), disables sandbox, and hides legacy capabilities", async () => {
      const srv = await startMilestoneServer({
        tempDir,
        isProd: true,
        allowDevSandbox: true,
        privyVerificationKey: ecPublicKeyPem,
      });
      activeClosers.push(srv.close);

      const capRes = await fetch(`${srv.baseUrl}/api/auth/capabilities`);
      assert.strictEqual(capRes.status, 200);
      const caps = (await capRes.json()) as any;
      assert.strictEqual(caps.legacyAuthDisabled, true);
      assert.strictEqual(caps.emailOtpConfigured, false);
      assert.strictEqual(caps.googleConfigured, false);
      assert.strictEqual(caps.devSandboxEnabled, false);
      assert.strictEqual(caps.privyConfigured, true);

      const otpStart = await fetch(`${srv.baseUrl}/api/auth/otp/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "prod@example.com" }),
      });
      assert.strictEqual(otpStart.status, 410);
      assert.strictEqual(((await otpStart.json()) as any).code, "LEGACY_AUTH_DISABLED");

      const otpVerify = await fetch(`${srv.baseUrl}/api/auth/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "prod@example.com", code: "123456" }),
      });
      assert.strictEqual(otpVerify.status, 410);
      assert.strictEqual(((await otpVerify.json()) as any).code, "LEGACY_AUTH_DISABLED");

      const googleRes = await fetch(`${srv.baseUrl}/api/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: "fake-token" }),
      });
      assert.strictEqual(googleRes.status, 410);
      assert.strictEqual(((await googleRes.json()) as any).code, "LEGACY_AUTH_DISABLED");

      const sandboxRes = await fetch(`${srv.baseUrl}/api/auth/sandbox`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona: "alice" }),
      });
      assert.strictEqual(sandboxRes.status, 403);
      assert.strictEqual(((await sandboxRes.json()) as any).code, "SANDBOX_DISABLED");

      // Even if a sandbox session existed on disk before, /api/auth/me must block restoring sandbox in production
      const nowIso = new Date().toISOString();
      await srv.backend.authRepo.saveUser({
        id: "usr-sandbox-alice",
        email: "alice@sandbox.trustflow.local",
        displayName: "Alice",
        avatar: "A",
        provider: "dev_sandbox",
        authVerified: false,
        stellarAddress: Keypair.random().publicKey(),
        walletCustody: "dev_sandbox",
        isSandbox: true,
        createdAt: nowIso,
        lastLoginAt: nowIso,
      });
      await srv.backend.authRepo.saveSession({
        token: "tf-sess-sandbox-prod-block",
        userId: "usr-sandbox-alice",
        provider: "dev_sandbox",
        isSandbox: true,
        createdAt: nowIso,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });

      const meRes = await fetch(`${srv.baseUrl}/api/auth/me`, {
        headers: { Authorization: "Bearer tf-sess-sandbox-prod-block" },
      });
      assert.strictEqual(meRes.status, 200);
      assert.deepStrictEqual(await meRes.json(), { user: null, wallet: null });

      const protectedRes = await fetch(`${srv.baseUrl}/api/agreements`, {
        headers: { Authorization: "Bearer tf-sess-sandbox-prod-block" },
      });
      assert.strictEqual(protectedRes.status, 401);
    });

    it("Production frontend controller fails closed if Privy is missing", async () => {
      const srv = await startMilestoneServer({
        tempDir,
        isProd: true,
        privyVerificationKey: ecPublicKeyPem,
      });
      activeClosers.push(srv.close);

      const controller = new TrustFlowAuthController({
        isPrivyConfigured: false,
        isProduction: true,
        storage: createMemoryAuthStorage(),
        apiBaseUrl: srv.baseUrl,
      });

      await controller.initSession();
      assert.strictEqual(controller.getState().capabilities.legacyAuthDisabled, true);
      await assert.rejects(() => controller.sendOtpCode("a@b.com"), /Privy authentication is required/i);
      await assert.rejects(() => controller.verifyOtpCode("a@b.com", "123456"), /Privy authentication is required/i);
      await assert.rejects(() => controller.loginWithGoogle("token"), /Privy authentication is required/i);
    });

    it("Dev OTP cannot silently merge into an existing Privy user sharing the same email (409 CROSS_PROVIDER_EMAIL_CONFLICT)", async () => {
      const embeddedAddr = Keypair.random().publicKey();
      const privySub = "did:privy:existing-email-owner";
      const sentCodes: string[] = [];

      const srv = await startMilestoneServer({
        tempDir,
        isProd: false,
        privyVerificationKey: ecPublicKeyPem,
        otpDelivery: {
          isConfigured: () => true,
          async sendOtp(_email, code) {
            sentCodes.push(code);
          },
        },
        fetchFn: (async (url: string) => {
          if (url === `https://api.privy.io/v1/users/${privySub}`) {
            return new Response(
              JSON.stringify({
                id: privySub,
                linked_accounts: [
                  { type: "email", address: "owner@example.com", verified_at: 1760000000 },
                  makePrivyApiWallet(embeddedAddr, { id: "pw-1" }),
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response("{}", { status: 404 });
        }) as typeof fetch,
      });
      activeClosers.push(srv.close);

      // 1. Create Privy account with verified owner@example.com
      const jwt = signEs256Jwt(
        { iss: "privy.io", sub: privySub, aud: srv.cfg.auth.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 },
        ecPrivateKeyPem
      );
      const syncRes = await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: jwt }),
      });
      assert.strictEqual(syncRes.status, 200);
      const originalPrivyUser = ((await syncRes.json()) as any).user;

      // 2. Attempt legacy Email OTP verify with the same email -> 409 conflict & Privy user stays untouched
      await fetch(`${srv.baseUrl}/api/auth/otp/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "owner@example.com" }),
      });
      const otpVerify = await fetch(`${srv.baseUrl}/api/auth/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "owner@example.com", code: sentCodes[0] }),
      });
      assert.strictEqual(otpVerify.status, 409);
      assert.strictEqual(((await otpVerify.json()) as any).code, "CROSS_PROVIDER_EMAIL_CONFLICT");

      const persisted = readJsonFile(path.join(tempDir, "users.json"));
      assert.strictEqual(Object.keys(persisted).length, 1);
      assert.strictEqual(persisted[originalPrivyUser.id].provider, "privy");
      assert.strictEqual(persisted[originalPrivyUser.id].stellarAddress, embeddedAddr);
    });
  });

  describe("Step 2: Server-Coordinated Privy Embedded Stellar Wallet Provisioning", () => {
    it("Existing embedded wallet is reused with 0 POST /v1/wallets calls", async () => {
      const existingAddr = Keypair.random().publicKey();
      const privySub = "did:privy:already-has-wallet";
      let createCalls = 0;

      const srv = await startMilestoneServer({
        tempDir,
        privyVerificationKey: ecPublicKeyPem,
        fetchFn: (async (url: string, init?: RequestInit) => {
          if (url === `https://api.privy.io/v1/users/${privySub}`) {
            return new Response(
              JSON.stringify({
                id: privySub,
                linked_accounts: [
                  { type: "email", address: "existing@example.com", verified_at: 1760000000 },
                  makePrivyApiWallet(existingAddr, { id: "pw-existing" }),
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          if (url === "https://api.privy.io/v1/wallets" && init?.method === "POST") {
            createCalls += 1;
          }
          return new Response("{}", { status: 404 });
        }) as typeof fetch,
      });
      activeClosers.push(srv.close);

      const jwt = signEs256Jwt(
        { iss: "privy.io", sub: privySub, aud: srv.cfg.auth.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 },
        ecPrivateKeyPem
      );
      const res = await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: jwt }),
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(createCalls, 0);
      assert.strictEqual(((await res.json()) as any).user.stellarAddress, existingAddr);
    });

    it("5 concurrent privy-sync calls for a 0-wallet user serialize into exactly 1 POST /v1/wallets with idempotency key", async () => {
      const createdAddr = Keypair.random().publicKey();
      const privySub = "did:privy:concurrent-provision";
      let hasWallet = false;
      let postCalls = 0;
      const seenIdempotencyKeys: string[] = [];
      const seenExternalIds: string[] = [];

      const srv = await startMilestoneServer({
        tempDir,
        privyVerificationKey: ecPublicKeyPem,
        fetchFn: (async (url: string, init?: RequestInit) => {
          const method = (init?.method || "GET").toUpperCase();
          if (url === `https://api.privy.io/v1/users/${privySub}`) {
            const linked_accounts: any[] = [
              { type: "email", address: "race@example.com", verified_at: 1760000000 },
            ];
            if (hasWallet) {
              linked_accounts.push(makePrivyApiWallet(createdAddr, { id: "pw-race-1" }));
            }
            return new Response(JSON.stringify({ id: privySub, linked_accounts }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (url.startsWith("https://api.privy.io/v1/wallets") && method === "GET") {
            const data = hasWallet
              ? [{ id: "pw-race-1", address: createdAddr, chain_type: "stellar", owner_id: privySub }]
              : [];
            return new Response(JSON.stringify({ data, next_cursor: null }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (url === "https://api.privy.io/v1/wallets" && method === "POST") {
            postCalls += 1;
            const headers = new Headers(init?.headers || {});
            seenIdempotencyKeys.push(headers.get("privy-idempotency-key") || "");
            const body = JSON.parse(String(init?.body || "{}"));
            seenExternalIds.push(body.external_id);
            await new Promise((r) => setTimeout(r, 40));
            hasWallet = true;
            return new Response(
              JSON.stringify({
                id: "pw-race-1",
                address: createdAddr,
                chain_type: "stellar",
                owner_id: privySub,
                external_id: body.external_id,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response("{}", { status: 404 });
        }) as typeof fetch,
      });
      activeClosers.push(srv.close);

      const jwt = signEs256Jwt(
        { iss: "privy.io", sub: privySub, aud: srv.cfg.auth.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 },
        ecPrivateKeyPem
      );

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accessToken: jwt }),
          })
        )
      );

      for (const r of responses) {
        assert.strictEqual(r.status, 200);
        const body = (await r.json()) as any;
        assert.strictEqual(body.user.stellarAddress, createdAddr);
      }

      assert.strictEqual(postCalls, 1, "Must issue strictly 1 Privy wallet creation request");
      assert.ok(seenIdempotencyKeys[0].length > 10);
      assert.match(seenExternalIds[0], /^tf_st_[0-9a-f]{32}$/);

      const users = readJsonFile(path.join(tempDir, "users.json"));
      const prov = readJsonFile(path.join(tempDir, "provisioning.json"));
      assert.strictEqual(Object.keys(users).length, 1);
      assert.strictEqual(prov[privySub].status, "completed");
      assert.strictEqual(prov[privySub].stellarAddress, createdAddr);
    });

    it("Ambiguous timeout/error on POST /v1/wallets reconciles against authoritative Privy GET when wallet WAS created", async () => {
      const recoveredAddr = Keypair.random().publicKey();
      const privySub = "did:privy:timeout-but-created";
      let createdOnPrivySide = false;

      const srv = await startMilestoneServer({
        tempDir,
        privyVerificationKey: ecPublicKeyPem,
        fetchFn: (async (url: string, init?: RequestInit) => {
          const method = (init?.method || "GET").toUpperCase();
          if (url === `https://api.privy.io/v1/users/${privySub}`) {
            return new Response(
              JSON.stringify({
                id: privySub,
                linked_accounts: [{ type: "email", address: "recover@example.com", verified_at: 1760000000 }],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          if (url.startsWith("https://api.privy.io/v1/wallets") && method === "GET") {
            const data = createdOnPrivySide
              ? [{ id: "pw-rec-1", address: recoveredAddr, chain_type: "stellar", owner_id: privySub }]
              : [];
            return new Response(JSON.stringify({ data, next_cursor: null }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (url === "https://api.privy.io/v1/wallets" && method === "POST") {
            // Simulate wallet created upstream, then network/gateway timeout (AbortError)
            createdOnPrivySide = true;
            const err = new Error("Aborted");
            err.name = "AbortError";
            throw err;
          }
          return new Response("{}", { status: 404 });
        }) as typeof fetch,
      });
      activeClosers.push(srv.close);

      const jwt = signEs256Jwt(
        { iss: "privy.io", sub: privySub, aud: srv.cfg.auth.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 },
        ecPrivateKeyPem
      );
      const res = await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: jwt }),
      });

      assert.strictEqual(res.status, 200);
      const body = (await res.json()) as any;
      assert.strictEqual(body.user.stellarAddress, recoveredAddr);

      const prov = readJsonFile(path.join(tempDir, "provisioning.json"));
      assert.strictEqual(prov[privySub].status, "completed");
      assert.strictEqual(prov[privySub].stellarAddress, recoveredAddr);
    });

    it("Ambiguous failure persists recovery metadata in provisioning.json, preserves idempotency key on retry, and reconciles cleanly across restart", async () => {
      const finalAddr = Keypair.random().publicKey();
      const privySub = "did:privy:ambiguous-retry";
      let failPostOnce = true;
      let failGetDuringReconcile = true;
      const recordedKeys: string[] = [];
      let walletExists = false;

      const makeFetch = (): typeof fetch => async (url, init) => {
        const u = String(url);
        const method = (init?.method || "GET").toUpperCase();
        if (u === `https://api.privy.io/v1/users/${privySub}`) {
          if (failGetDuringReconcile && !failPostOnce) {
            return new Response(JSON.stringify({ error: "Privy GET unavailable" }), { status: 502 });
          }
          const linked_accounts: any[] = [
            { type: "email", address: "ambiguous@example.com", verified_at: 1760000000 },
          ];
          if (walletExists) {
            linked_accounts.push(makePrivyApiWallet(finalAddr, { id: "pw-amb-1" }));
          }
          return new Response(JSON.stringify({ id: privySub, linked_accounts }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (u.startsWith("https://api.privy.io/v1/wallets") && method === "GET") {
          const data = walletExists
            ? [{ id: "pw-amb-1", address: finalAddr, chain_type: "stellar", owner_id: privySub }]
            : [];
          return new Response(JSON.stringify({ data, next_cursor: null }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (u === "https://api.privy.io/v1/wallets" && method === "POST") {
          recordedKeys.push(new Headers(init?.headers || {}).get("privy-idempotency-key") || "");
          if (failPostOnce) {
            failPostOnce = false;
            return new Response(JSON.stringify({ error: "Upstream 502" }), { status: 502 });
          }
          walletExists = true;
          return new Response(
            JSON.stringify({
              id: "pw-amb-1",
              address: finalAddr,
              chain_type: "stellar",
              owner_id: privySub,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response("{}", { status: 404 });
      };

      const srv1 = await startMilestoneServer({
        tempDir,
        privyVerificationKey: ecPublicKeyPem,
        fetchFn: makeFetch(),
      });
      activeClosers.push(srv1.close);

      const jwt = signEs256Jwt(
        { iss: "privy.io", sub: privySub, aud: srv1.cfg.auth.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 },
        ecPrivateKeyPem
      );

      const failRes = await fetch(`${srv1.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: jwt }),
      });
      assert.strictEqual(failRes.status, 502);
      assert.strictEqual(((await failRes.json()) as any).code, "PRIVY_PROVISIONING_FAILED");

      const provAfterFail = readJsonFile(path.join(tempDir, "provisioning.json"));
      assert.strictEqual(provAfterFail[privySub].status, "ambiguous");
      const firstIdempotencyKey = provAfterFail[privySub].idempotencyKey;
      assert.ok(firstIdempotencyKey);

      // Simulate fresh server restart reusing tempDir and retrying cleanly
      failGetDuringReconcile = false;
      await srv1.close();
      const srv2 = await startMilestoneServer({
        tempDir,
        privyVerificationKey: ecPublicKeyPem,
        fetchFn: makeFetch(),
      });
      activeClosers.push(srv2.close);

      const retryRes = await fetch(`${srv2.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: jwt }),
      });
      assert.strictEqual(retryRes.status, 200);
      assert.strictEqual(((await retryRes.json()) as any).user.stellarAddress, finalAddr);
      assert.strictEqual(recordedKeys.length, 2);
      assert.strictEqual(recordedKeys[0], recordedKeys[1], "Must reuse persisted idempotency key on retry");

      const provAfterRetry = readJsonFile(path.join(tempDir, "provisioning.json"));
      assert.strictEqual(provAfterRetry[privySub].status, "completed");
    });

    it("Multiple embedded wallets on Privy fail loudly with 409 MULTIPLE_EMBEDDED_STELLAR_WALLETS", async () => {
      const addr1 = Keypair.random().publicKey();
      const addr2 = Keypair.random().publicKey();
      const privySub = "did:privy:multi-wallets";

      const srv = await startMilestoneServer({
        tempDir,
        privyVerificationKey: ecPublicKeyPem,
        fetchFn: (async (url: string) => {
          if (url === `https://api.privy.io/v1/users/${privySub}`) {
            return new Response(
              JSON.stringify({
                id: privySub,
                linked_accounts: [
                  makePrivyApiWallet(addr1, { id: "pw-1" }),
                  makePrivyApiWallet(addr2, { id: "pw-2" }),
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response("{}", { status: 404 });
        }) as typeof fetch,
      });
      activeClosers.push(srv.close);

      const jwt = signEs256Jwt(
        { iss: "privy.io", sub: privySub, aud: srv.cfg.auth.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 },
        ecPrivateKeyPem
      );
      const res = await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: jwt }),
      });
      assert.strictEqual(res.status, 409);
      assert.strictEqual(((await res.json()) as any).code, "MULTIPLE_EMBEDDED_STELLAR_WALLETS");
    });

    it("disableAutoProvision in non-prod skips provisioning and rejects 0-wallet user with 403 NO_EMBEDDED_STELLAR_WALLET", async () => {
      const privySub = "did:privy:test-mode-no-provision";
      let postCalls = 0;

      const srv = await startMilestoneServer({
        tempDir,
        isProd: false,
        privyVerificationKey: ecPublicKeyPem,
        fetchFn: (async (url: string, init?: RequestInit) => {
          if (url === `https://api.privy.io/v1/users/${privySub}`) {
            return new Response(
              JSON.stringify({
                id: privySub,
                linked_accounts: [{ type: "email", address: "test@example.com", verified_at: 1760000000 }],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          if (url === "https://api.privy.io/v1/wallets" && init?.method === "POST") {
            postCalls += 1;
          }
          return new Response("{}", { status: 404 });
        }) as typeof fetch,
      });
      activeClosers.push(srv.close);

      const jwt = signEs256Jwt(
        { iss: "privy.io", sub: privySub, aud: srv.cfg.auth.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 },
        ecPrivateKeyPem
      );
      const res = await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: jwt, disableAutoProvision: true }),
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(((await res.json()) as any).code, "NO_EMBEDDED_STELLAR_WALLET");
      assert.strictEqual(postCalls, 0);
    });
  });

  describe("Step 3: Multi-Wallet Data Model, SEP-53 Freighter Linking & Agreement Access", () => {
    async function seedPrivySession(baseUrl: string, appId: string, privySub: string, embeddedAddr: string) {
      const jwt = signEs256Jwt(
        { iss: "privy.io", sub: privySub, aud: appId, exp: Math.floor(Date.now() / 1000) + 600 },
        ecPrivateKeyPem
      );
      const res = await fetch(`${baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: jwt }),
      });
      assert.strictEqual(res.status, 200);
      return (await res.json()) as { token: string; user: any; wallet: any };
    }

    it("normalizeUserWallets migrates legacy users idempotently without duplicate wallet entries", () => {
      const addr = Keypair.random().publicKey();
      const legacyUser = {
        id: "usr-legacy-1",
        email: "legacy@example.com",
        displayName: "Legacy",
        avatar: "L",
        provider: "privy" as const,
        authVerified: true,
        providerSubject: "did:privy:legacy",
        stellarAddress: addr,
        walletCustody: "privy_embedded" as const,
        isSandbox: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        lastLoginAt: "2026-01-02T00:00:00.000Z",
      };

      const once = normalizeUserWallets(legacyUser);
      assert.strictEqual(once.primaryWalletAddress, addr);
      assert.strictEqual(once.wallets?.length, 1);
      assert.strictEqual(once.wallets?.[0].address, addr);
      assert.strictEqual(once.wallets?.[0].custody, "privy_embedded");
      assert.strictEqual(once.wallets?.[0].isPrimary, true);

      const twice = normalizeUserWallets(once);
      assert.deepStrictEqual(twice.wallets, once.wallets);
    });

    it("Legacy POST /api/auth/wallet/link returns 410 LEGACY_WALLET_LINK_DISABLED without modifying user", async () => {
      const embeddedAddr = Keypair.random().publicKey();
      const externalAddr = Keypair.random().publicKey();
      const privySub = "did:privy:legacy-link-check";

      const srv = await startMilestoneServer({
        tempDir,
        privyVerificationKey: ecPublicKeyPem,
        fetchFn: (async (url: string) => {
          if (url === `https://api.privy.io/v1/users/${privySub}`) {
            return new Response(
              JSON.stringify({
                id: privySub,
                linked_accounts: [makePrivyApiWallet(embeddedAddr, { id: "pw-1" })],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response("{}", { status: 404 });
        }) as typeof fetch,
      });
      activeClosers.push(srv.close);

      const session = await seedPrivySession(srv.baseUrl, srv.cfg.auth.privyAppId!, privySub, embeddedAddr);

      const res = await fetch(`${srv.baseUrl}/api/auth/wallet/link`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ stellarAddress: externalAddr }),
      });
      assert.strictEqual(res.status, 410);
      assert.strictEqual(((await res.json()) as any).code, "LEGACY_WALLET_LINK_DISABLED");

      const meRes = await fetch(`${srv.baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      const me = (await meRes.json()) as any;
      assert.strictEqual(me.user.stellarAddress, embeddedAddr);
      assert.strictEqual(me.user.wallets.length, 1);
    });

    it("Valid SEP-53 challenge+verify adds Freighter external wallet alongside Privy embedded wallet; rejects bad/expired/replayed/cross-user/duplicate proofs", async () => {
      const embeddedA = Keypair.random().publicKey();
      const embeddedB = Keypair.random().publicKey();
      const freighterKp = Keypair.random();
      const freighterAddr = freighterKp.publicKey();
      const attackerKp = Keypair.random();
      const subA = "did:privy:sep53-user-a";
      const subB = "did:privy:sep53-user-b";

      const srv = await startMilestoneServer({
        tempDir,
        privyVerificationKey: ecPublicKeyPem,
        fetchFn: (async (url: string) => {
          if (url === `https://api.privy.io/v1/users/${subA}`) {
            return new Response(
              JSON.stringify({ id: subA, linked_accounts: [makePrivyApiWallet(embeddedA, { id: "pw-a" })] }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          if (url === `https://api.privy.io/v1/users/${subB}`) {
            return new Response(
              JSON.stringify({ id: subB, linked_accounts: [makePrivyApiWallet(embeddedB, { id: "pw-b" })] }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response("{}", { status: 404 });
        }) as typeof fetch,
      });
      activeClosers.push(srv.close);

      const sessA = await seedPrivySession(srv.baseUrl, srv.cfg.auth.privyAppId!, subA, embeddedA);
      const sessB = await seedPrivySession(srv.baseUrl, srv.cfg.auth.privyAppId!, subB, embeddedB);

      // 1. Issue challenge for User A
      const chRes = await fetch(`${srv.baseUrl}/api/auth/wallets/external/challenge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessA.token}`,
        },
        body: JSON.stringify({ address: freighterAddr }),
      });
      assert.strictEqual(chRes.status, 200);
      const ch = (await chRes.json()) as any;
      assert.ok(ch.challengeId);
      assert.ok(ch.message.includes(freighterAddr));

      const validSig = Buffer.from(freighterKp.signMessage(ch.message)).toString("base64");
      const wrongKeySig = Buffer.from(attackerKp.signMessage(ch.message)).toString("base64");

      // 2. Wrong signature rejected (401)
      const badSigRes = await fetch(`${srv.baseUrl}/api/auth/wallets/external/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessA.token}` },
        body: JSON.stringify({ challengeId: ch.challengeId, address: freighterAddr, signature: wrongKeySig }),
      });
      assert.strictEqual(badSigRes.status, 401);
      assert.strictEqual(((await badSigRes.json()) as any).code, "INVALID_WALLET_SIGNATURE");

      // 3. Address mismatch rejected (400)
      const mismatchRes = await fetch(`${srv.baseUrl}/api/auth/wallets/external/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessA.token}` },
        body: JSON.stringify({
          challengeId: ch.challengeId,
          address: attackerKp.publicKey(),
          signature: validSig,
        }),
      });
      assert.strictEqual(mismatchRes.status, 400);
      assert.strictEqual(((await mismatchRes.json()) as any).code, "CHALLENGE_ADDRESS_MISMATCH");

      // 4. Cross-user redemption rejected (403)
      const crossUserRes = await fetch(`${srv.baseUrl}/api/auth/wallets/external/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessB.token}` },
        body: JSON.stringify({ challengeId: ch.challengeId, address: freighterAddr, signature: validSig }),
      });
      assert.strictEqual(crossUserRes.status, 403);
      assert.strictEqual(((await crossUserRes.json()) as any).code, "CHALLENGE_USER_MISMATCH");

      // 5. Concurrent single-use verification race: only 1 succeeds, other gets 409 CHALLENGE_ALREADY_USED
      const [v1, v2] = await Promise.all([
        fetch(`${srv.baseUrl}/api/auth/wallets/external/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessA.token}` },
          body: JSON.stringify({ challengeId: ch.challengeId, address: freighterAddr, signature: validSig }),
        }),
        fetch(`${srv.baseUrl}/api/auth/wallets/external/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessA.token}` },
          body: JSON.stringify({ challengeId: ch.challengeId, address: freighterAddr, signature: validSig }),
        }),
      ]);
      const statuses = [v1.status, v2.status].sort((a, b) => a - b);
      assert.deepStrictEqual(statuses, [200, 409]);

      // Verify additive wallet structure preserved Privy embedded primary wallet
      const meA = (await (
        await fetch(`${srv.baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${sessA.token}` } })
      ).json()) as any;
      assert.strictEqual(meA.user.stellarAddress, embeddedA);
      assert.strictEqual(meA.user.primaryWalletAddress, embeddedA);
      assert.strictEqual(meA.user.walletCustody, "privy_embedded");
      assert.strictEqual(meA.user.wallets.length, 2);

      // 6. Another user cannot challenge or link the same external wallet (409 WALLET_ALREADY_LINKED)
      const dupCh = await fetch(`${srv.baseUrl}/api/auth/wallets/external/challenge`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessB.token}` },
        body: JSON.stringify({ address: freighterAddr }),
      });
      assert.strictEqual(dupCh.status, 409);
      assert.strictEqual(((await dupCh.json()) as any).code, "WALLET_ALREADY_LINKED");

      // 7. Expired challenge rejected (401 CHALLENGE_EXPIRED)
      const expiredChallenge: WalletChallengeRecord = {
        id: "wch-expired-test",
        userId: sessB.user.id,
        address: attackerKp.publicKey(),
        provider: "freighter",
        network: "testnet",
        domain: "trustflow.app",
        nonce: "deadbeef",
        message: "TrustFlow expired test",
        createdAt: new Date(Date.now() - 600_000).toISOString(),
        expiresAt: new Date(Date.now() - 10_000).toISOString(),
        consumedAt: null,
      };
      await srv.backend.authRepo.saveWalletChallenge(expiredChallenge);
      const expiredSig = Buffer.from(attackerKp.signMessage(expiredChallenge.message)).toString("base64");
      const expiredVerify = await fetch(`${srv.baseUrl}/api/auth/wallets/external/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessB.token}` },
        body: JSON.stringify({
          challengeId: expiredChallenge.id,
          address: attackerKp.publicKey(),
          signature: expiredSig,
        }),
      });
      assert.strictEqual(expiredVerify.status, 401);
      assert.strictEqual(((await expiredVerify.json()) as any).code, "CHALLENGE_EXPIRED");
    });

    it("Multi-wallet agreement authorization + safe unlinking rules (embedded blocked, active blocked, terminal allowed + read-only)", async () => {
      const embeddedA = Keypair.random().publicKey();
      const embeddedB = Keypair.random().publicKey();
      const freighterKp = Keypair.random();
      const freighterAddr = freighterKp.publicKey();
      const subA = "did:privy:agr-user-a";
      const subB = "did:privy:agr-user-b";

      const srv = await startMilestoneServer({
        tempDir,
        privyVerificationKey: ecPublicKeyPem,
        fetchFn: (async (url: string) => {
          if (url === `https://api.privy.io/v1/users/${subA}`) {
            return new Response(
              JSON.stringify({ id: subA, linked_accounts: [makePrivyApiWallet(embeddedA, { id: "pw-a" })] }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          if (url === `https://api.privy.io/v1/users/${subB}`) {
            return new Response(
              JSON.stringify({ id: subB, linked_accounts: [makePrivyApiWallet(embeddedB, { id: "pw-b" })] }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response("{}", { status: 404 });
        }) as typeof fetch,
      });
      activeClosers.push(srv.close);

      const sessA = await seedPrivySession(srv.baseUrl, srv.cfg.auth.privyAppId!, subA, embeddedA);
      const sessB = await seedPrivySession(srv.baseUrl, srv.cfg.auth.privyAppId!, subB, embeddedB);

      // Link Freighter wallet via controller + mock FreighterBridgeLike
      const storage = createMemoryAuthStorage();
      storage.setItem(AUTH_TOKEN_STORAGE_KEY, sessA.token);
      const controller = new TrustFlowAuthController({
        isPrivyConfigured: true,
        storage,
        apiBaseUrl: srv.baseUrl,
      });
      await controller.initSession();

      const mockBridge: FreighterBridgeLike = {
        isAvailable: async () => true,
        connect: async () => ({ address: freighterAddr }),
        signStellarMessage: async (message, opts) => ({
          signature: Buffer.from(freighterKp.signMessage(message)).toString("base64"),
          signerAddress: opts?.accountToSign || freighterAddr,
        }),
      };

      const linkedExternal = await controller.linkExternalWalletWithFreighter(mockBridge);
      assert.strictEqual(linkedExternal.address, freighterAddr);
      assert.strictEqual(controller.getState().user?.wallets?.length, 2);

      const embeddedWalletId = controller.getState().user!.wallets!.find((w) => w.custody === "privy_embedded")!.id;

      // 1. Embedded wallet cannot be unlinked (403 EMBEDDED_WALLET_IMMUTABLE)
      const unlinkEmb = await fetch(`${srv.baseUrl}/api/auth/wallets/${embeddedWalletId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${sessA.token}` },
      });
      assert.strictEqual(unlinkEmb.status, 403);
      assert.strictEqual(((await unlinkEmb.json()) as any).code, "EMBEDDED_WALLET_IMMUTABLE");

      // 2. Create agreement where User A is payer using linked Freighter address, User B is recipient
      const agrId = `agr-multi-${Date.now()}`;
      const createAgr = await fetch(`${srv.baseUrl}/api/agreements`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessA.token}`,
        },
        body: JSON.stringify({
          id: agrId,
          transactionType: "WORK",
          title: "Freighter Multi-Wallet Agreement",
          description: "Testing active external wallet agreement authorization",
          terms: {
            amount: "100.00",
            asset: "USDC",
            payer: freighterAddr,
            recipient: embeddedB,
            approver: freighterAddr,
            title: "Freighter Multi-Wallet Agreement",
            description: "Testing active external wallet agreement authorization",
            deliverables: ["Delivered milestone"],
            condition: "Payer reviews and approves",
            cancellationTerms: "Mutual cancellation",
            deadline: new Date(Date.now() + 86_400_000).toISOString(),
            contractId: "C_TEST_1",
            domain: "trustflow-testnet",
            network: "testnet",
            version: 1,
          },
          canonicalHash: crypto.randomBytes(32).toString("hex"),
          status: "CREATED",
        }),
      });
      assert.strictEqual(createAgr.status, 201);
      const createdAgr = (await createAgr.json()) as any;

      // 3. Cannot unlink active external wallet while agreement is non-terminal (409 WALLET_IN_ACTIVE_AGREEMENT)
      const blockedUnlink = await fetch(`${srv.baseUrl}/api/auth/wallets/${linkedExternal.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${sessA.token}` },
      });
      assert.strictEqual(blockedUnlink.status, 409);
      assert.strictEqual(((await blockedUnlink.json()) as any).code, "WALLET_IN_ACTIVE_AGREEMENT");

      // 4. Both sides request + confirm cancellation -> terminal CANCELLED
      const reqCancel = await fetch(`${srv.baseUrl}/api/agreements/${agrId}/cancel-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessA.token}` },
        body: JSON.stringify({ expectedVersion: createdAgr.version }),
      });
      assert.strictEqual(reqCancel.status, 200);
      const afterReq = (await reqCancel.json()) as any;

      const confirmCancel = await fetch(`${srv.baseUrl}/api/agreements/${agrId}/cancel-confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessB.token}` },
        body: JSON.stringify({ expectedVersion: afterReq.version }),
      });
      assert.strictEqual(confirmCancel.status, 200);

      // 5. Terminal agreement allows safe unlinking!
      await controller.unlinkExternalWallet(linkedExternal.id);
      const activeAfterUnlink = (controller.getState().user?.wallets || []).filter(
        (w) => w.status === "active"
      );
      assert.strictEqual(activeAfterUnlink.length, 1);
      assert.strictEqual(activeAfterUnlink[0].address, embeddedA);

      // 6. Historical terminal agreement remains readable via /api/agreements, while new agreement using unlinked wallet is rejected (403)
      const listRes = await fetch(`${srv.baseUrl}/api/agreements`, {
        headers: { Authorization: `Bearer ${sessA.token}` },
      });
      assert.strictEqual(listRes.status, 200);
      const listed = (await listRes.json()) as any[];
      assert.strictEqual(listed.length, 1);
      assert.strictEqual(listed[0].id, agrId);

      const postUnlinkCreate = await fetch(`${srv.baseUrl}/api/agreements`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessA.token}` },
        body: JSON.stringify({
          id: `agr-unlinked-fail-${Date.now()}`,
          transactionType: "WORK",
          title: "Should fail after unlink",
          description: "Test",
          terms: { ...createdAgr.terms },
          canonicalHash: crypto.randomBytes(32).toString("hex"),
          status: "CREATED",
        }),
      });
      assert.strictEqual(postUnlinkCreate.status, 403);
    });
  });

  describe("Step 4: Session Reconciliation, Centralized 401 Handling, Account Switching & Privy Account Linking", () => {
    it("Reload after Privy logout invalidates stale Privy session while preserving non-Privy dev sandbox sessions", async () => {
      const addr = Keypair.random().publicKey();
      const privySub = "did:privy:reload-logout";
      const srv = await startMilestoneServer({
        tempDir,
        isProd: false,
        allowDevSandbox: true,
        privyVerificationKey: ecPublicKeyPem,
        fetchFn: (async (url: string) => {
          if (url === `https://api.privy.io/v1/users/${privySub}`) {
            return new Response(
              JSON.stringify({
                id: privySub,
                linked_accounts: [
                  { type: "email", address: "reload@example.com", verified_at: 1760000000 },
                  makePrivyApiWallet(addr, { id: "pw-r" }),
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response("{}", { status: 404 });
        }) as typeof fetch,
      });
      activeClosers.push(srv.close);

      // 1. Create valid Privy session
      const jwt = signEs256Jwt(
        { iss: "privy.io", sub: privySub, aud: srv.cfg.auth.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 },
        ecPrivateKeyPem
      );
      const syncBody = (await (
        await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: jwt }),
        })
      ).json()) as any;

      const privyStorage = createMemoryAuthStorage();
      privyStorage.setItem(AUTH_TOKEN_STORAGE_KEY, syncBody.token);
      const c1 = new TrustFlowAuthController({
        isPrivyConfigured: true,
        storage: privyStorage,
        apiBaseUrl: srv.baseUrl,
      });

      // Case A: Privy ready=true & authenticated=false arrives BEFORE initSession finishes (or right after)
      await c1.initSession();
      assert.strictEqual(c1.getState().isAuthenticated, true);
      c1.updatePrivySnapshot({ ready: true, authenticated: false, user: null });
      await new Promise((r) => setTimeout(r, 30));

      assert.strictEqual(c1.getState().isAuthenticated, false);
      assert.strictEqual(c1.getState().stage, "unauthenticated");
      assert.strictEqual(c1.getState().user, null);
      assert.strictEqual(privyStorage.getItem(AUTH_TOKEN_STORAGE_KEY), null);

      // Backend logout call revoked the stale TrustFlow token as well
      const afterRevokeMe = await fetch(`${srv.baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${syncBody.token}` },
      });
      assert.strictEqual(afterRevokeMe.status, 200);
      assert.deepStrictEqual(await afterRevokeMe.json(), { user: null, wallet: null });

      const afterRevokeProtected = await fetch(`${srv.baseUrl}/api/agreements`, {
        headers: { Authorization: `Bearer ${syncBody.token}` },
      });
      assert.strictEqual(afterRevokeProtected.status, 401);

      // 2. Non-Privy dev sandbox session survives reload even when Privy reports ready=true & authenticated=false
      const sandboxStorage = createMemoryAuthStorage();
      const cSandbox = new TrustFlowAuthController({
        isPrivyConfigured: true,
        defaultDevSandboxEnabled: true,
        storage: sandboxStorage,
        apiBaseUrl: srv.baseUrl,
      });
      await cSandbox.initSession();
      await cSandbox.enterSandbox("alice");
      const sandboxToken = sandboxStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
      assert.ok(sandboxToken);

      const cSandboxReload = new TrustFlowAuthController({
        isPrivyConfigured: true,
        defaultDevSandboxEnabled: true,
        storage: sandboxStorage,
        apiBaseUrl: srv.baseUrl,
      });
      cSandboxReload.updatePrivySnapshot({ ready: true, authenticated: false, user: null });
      await cSandboxReload.initSession();
      assert.strictEqual(cSandboxReload.getState().isAuthenticated, true);
      assert.strictEqual(cSandboxReload.getState().user?.provider, "dev_sandbox");
    });

    it("authenticatedFetch clears session on 401 (with 1 guarded Privy resync attempt), while 403/500/network errors never log user out", async () => {
      const addr = Keypair.random().publicKey();
      const privySub = "did:privy:auth-fetch-user";
      const storage = createMemoryAuthStorage();

      let mode: "ok" | "403" | "500" | "network" | "401-always" | "401-recover" = "ok";
      let resyncPosts = 0;

      const fetchFn: typeof fetch = async (input) => {
        const url = String(input);
        if (url.endsWith("/api/auth/me")) {
          return new Response(
            JSON.stringify({
              capabilities: {
                emailOtpConfigured: false,
                googleConfigured: false,
                privyConfigured: true,
                devSandboxEnabled: false,
              },
              user: {
                id: "usr-1",
                email: "u@example.com",
                displayName: "U",
                avatar: "U",
                provider: "privy",
                authVerified: true,
                providerSubject: privySub,
                stellarAddress: addr,
                walletCustody: "privy_embedded",
                isSandbox: false,
                createdAt: new Date().toISOString(),
                lastLoginAt: new Date().toISOString(),
              },
              wallet: {
                address: addr,
                network: "testnet",
                custody: "privy_embedded",
                isEmbedded: true,
                balanceXLM: "0.00",
                balanceUSDC: "0.00",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.endsWith("/api/auth/privy-sync")) {
          resyncPosts += 1;
          return new Response(
            JSON.stringify({
              token: "tf-sess-refreshed",
              user: {
                id: "usr-1",
                email: "u@example.com",
                displayName: "U",
                avatar: "U",
                provider: "privy",
                authVerified: true,
                providerSubject: privySub,
                stellarAddress: addr,
                walletCustody: "privy_embedded",
                isSandbox: false,
                createdAt: new Date().toISOString(),
                lastLoginAt: new Date().toISOString(),
              },
              wallet: {
                address: addr,
                network: "testnet",
                custody: "privy_embedded",
                isEmbedded: true,
                balanceXLM: "0.00",
                balanceUSDC: "0.00",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (mode === "403") return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
        if (mode === "500") return new Response(JSON.stringify({ error: "Server error" }), { status: 500 });
        if (mode === "network") throw new Error("ECONNRESET");
        if (mode === "401-recover") {
          mode = "ok";
          return new Response(JSON.stringify({ error: "Expired" }), { status: 401 });
        }
        if (mode === "401-always") return new Response(JSON.stringify({ error: "Revoked" }), { status: 401 });
        return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
      };

      storage.setItem(AUTH_TOKEN_STORAGE_KEY, "tf-sess-initial");
      const controller = new TrustFlowAuthController({
        isPrivyConfigured: true,
        fetchFn,
        storage,
        apiBaseUrl: "http://localhost:3000",
      });
      controller.setRuntimeActions({
        getAccessToken: async () => "privy-jwt",
      });
      await controller.initSession();
      controller.updatePrivySnapshot({
        ready: true,
        authenticated: true,
        user: { id: privySub, linkedAccounts: [makeClientPrivyWallet(addr)] },
      });
      assert.strictEqual(controller.getState().isAuthenticated, true);

      // 1. 403, 500, and network error must keep user authenticated
      mode = "403";
      assert.strictEqual((await controller.authenticatedFetch("http://localhost:3000/api/agreements")).status, 403);
      assert.strictEqual(controller.getState().isAuthenticated, true);

      mode = "500";
      assert.strictEqual((await controller.authenticatedFetch("http://localhost:3000/api/agreements")).status, 500);
      assert.strictEqual(controller.getState().isAuthenticated, true);

      mode = "network";
      await assert.rejects(() => controller.authenticatedFetch("http://localhost:3000/api/agreements"), /ECONNRESET/);
      assert.strictEqual(controller.getState().isAuthenticated, true);

      // 2. 401 when Privy is still active performs 1 guarded resync and retries original request seamlessly
      mode = "401-recover";
      const okRetry = await controller.authenticatedFetch("http://localhost:3000/api/agreements");
      assert.strictEqual(okRetry.status, 200);
      assert.strictEqual(resyncPosts, 1);
      assert.strictEqual(storage.getItem(AUTH_TOKEN_STORAGE_KEY), "tf-sess-refreshed");

      // 3. Persistent 401 later in the session runs one independent recovery attempt, then clears session cleanly without infinite loop
      mode = "401-always";
      const failRes = await controller.authenticatedFetch("http://localhost:3000/api/agreements");
      assert.strictEqual(failRes.status, 401);
      assert.strictEqual(controller.getState().isAuthenticated, false);
      assert.strictEqual(controller.getState().stage, "unauthenticated");
      assert.strictEqual(storage.getItem(AUTH_TOKEN_STORAGE_KEY), null);
      assert.strictEqual(resyncPosts, 2);
    });

    it("syncPrivyUserDirect respects syncEpoch and cannot overwrite switched account", async () => {
      const addrA = Keypair.random().publicKey();
      const addrB = Keypair.random().publicKey();
      const subA = "did:privy:direct-a";
      const subB = "did:privy:direct-b";
      const storage = createMemoryAuthStorage();

      let resolveSlowA!: () => void;
      const slowAPromise = new Promise<void>((r) => {
        resolveSlowA = r;
      });

      const fetchFn: typeof fetch = async (input, init) => {
        const url = String(input);
        if (url.endsWith("/api/auth/me")) {
          return new Response(
            JSON.stringify({ capabilities: { emailOtpConfigured: false, googleConfigured: false, privyConfigured: true, devSandboxEnabled: false }, user: null, wallet: null }),
            { status: 200 }
          );
        }
        if (url.endsWith("/api/auth/privy-sync")) {
          const body = JSON.parse(String(init?.body || "{}"));
          if (body.accessToken === "tok-a") {
            await slowAPromise;
            return new Response(
              JSON.stringify({
                token: "sess-a",
                user: { id: "u-a", email: "a@x.com", displayName: "A", avatar: "A", provider: "privy", authVerified: true, providerSubject: subA, stellarAddress: addrA, walletCustody: "privy_embedded", isSandbox: false, createdAt: "", lastLoginAt: "" },
                wallet: { address: addrA, network: "testnet", custody: "privy_embedded", isEmbedded: true, balanceXLM: "0.00", balanceUSDC: "0.00" },
              }),
              { status: 200 }
            );
          }
          return new Response(
            JSON.stringify({
              token: "sess-b",
              user: { id: "u-b", email: "b@x.com", displayName: "B", avatar: "B", provider: "privy", authVerified: true, providerSubject: subB, stellarAddress: addrB, walletCustody: "privy_embedded", isSandbox: false, createdAt: "", lastLoginAt: "" },
              wallet: { address: addrB, network: "testnet", custody: "privy_embedded", isEmbedded: true, balanceXLM: "0.00", balanceUSDC: "0.00" },
            }),
            { status: 200 }
          );
        }
        return new Response("{}", { status: 404 });
      };

      const controller = new TrustFlowAuthController({
        isPrivyConfigured: true,
        fetchFn,
        storage,
        apiBaseUrl: "http://localhost:3000",
      });
      controller.setRuntimeActions({ getAccessToken: async () => "tok-b" });
      await controller.initSession();

      // Start stale syncPrivyUserDirect for A while switched to B
      const directA = controller.syncPrivyUserDirect({ accessToken: "tok-a", stellarAddress: addrA });
      controller.updatePrivySnapshot({
        ready: true,
        authenticated: true,
        user: { id: subB, linkedAccounts: [makeClientPrivyWallet(addrB)] },
      });
      await new Promise((r) => setTimeout(r, 40));

      resolveSlowA();
      await directA;
      await new Promise((r) => setTimeout(r, 40));

      assert.strictEqual(controller.getState().user?.providerSubject, subB);
      assert.strictEqual(storage.getItem(AUTH_TOKEN_STORAGE_KEY), "sess-b");
    });

    it("Privy account linking preserves privySub, refreshes profile on success, handles duplicates & cancellation safely", async () => {
      const addr = Keypair.random().publicKey();
      const privySub = "did:privy:account-linking";
      let linkedGoogle = false;

      const srv = await startMilestoneServer({
        tempDir,
        privyVerificationKey: ecPublicKeyPem,
        fetchFn: (async (url: string) => {
          if (url === `https://api.privy.io/v1/users/${privySub}`) {
            const accounts: any[] = [
              { type: "email", address: "main@example.com", verified_at: 1760000000 },
              makePrivyApiWallet(addr, { id: "pw-link" }),
            ];
            if (linkedGoogle) {
              accounts.push({
                type: "google_oauth",
                email: "main@example.com",
                name: "Linked Google User",
                verified_at: 1760000001,
              });
            }
            return new Response(JSON.stringify({ id: privySub, linked_accounts: accounts }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response("{}", { status: 404 });
        }) as typeof fetch,
      });
      activeClosers.push(srv.close);

      const storage = createMemoryAuthStorage();
      const jwt = signEs256Jwt(
        { iss: "privy.io", sub: privySub, aud: srv.cfg.auth.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 },
        ecPrivateKeyPem
      );

      let triggerLinkOutcome: "success" | "duplicate" | "cancelled" = "success";
      const controller = new TrustFlowAuthController({
        isPrivyConfigured: true,
        storage,
        apiBaseUrl: srv.baseUrl,
        hydrationWaitMs: 60,
        hydrationPollMs: 15,
      });

      const basePrivyUser: PrivyUserLike = {
        id: privySub,
        linkedAccounts: [makeClientPrivyWallet(addr)],
      };

      controller.setRuntimeActions({
        getAccessToken: async () => jwt,
        refreshUser: async () => basePrivyUser,
        linkEmail: async () => {
          if (triggerLinkOutcome === "cancelled") {
            controller.handlePrivyLinkError("exited_link_flow");
          }
        },
        linkGoogle: async () => {
          if (triggerLinkOutcome === "duplicate") {
            controller.handlePrivyLinkError(new Error("Account is already linked to another Privy user"));
            return;
          }
          linkedGoogle = true;
          await controller.handlePrivyLinkSuccess({
            id: privySub,
            linkedAccounts: [
              ...basePrivyUser.linkedAccounts!,
              { type: "google_oauth", name: "Linked Google User" },
            ],
          });
        },
      });

      await controller.initSession();
      controller.updatePrivySnapshot({ ready: true, authenticated: true, user: basePrivyUser });
      await new Promise((r) => setTimeout(r, 80));

      const originalUserId = controller.getState().user?.id;
      assert.ok(originalUserId);

      // 1. Duplicate account rejection shows clear non-destructive error
      triggerLinkOutcome = "duplicate";
      await controller.startPrivyGoogleLink();
      assert.match(controller.getState().privyLinkingError || "", /already linked to a different Privy account/i);
      assert.strictEqual(controller.getState().user?.id, originalUserId);
      assert.strictEqual(controller.getState().user?.stellarAddress, addr);

      // 2. Cancelled email link keeps existing account/wallet intact
      triggerLinkOutcome = "cancelled";
      await controller.startPrivyEmailLink();
      assert.match(controller.getState().privyLinkingError || "", /cancelled/i);
      assert.strictEqual(controller.getState().user?.stellarAddress, addr);

      // 3. Successful Google link preserves privySub, keeps wallet, and refreshes display name from Privy
      triggerLinkOutcome = "success";
      await controller.startPrivyGoogleLink();
      assert.strictEqual(controller.getState().privyLinkingBusy, false);
      assert.strictEqual(controller.getState().privyLinkingError, null);
      assert.strictEqual(controller.getState().user?.id, originalUserId);
      assert.strictEqual(controller.getState().user?.providerSubject, privySub);
      assert.strictEqual(controller.getState().user?.stellarAddress, addr);
      assert.strictEqual(controller.getState().user?.displayName, "Linked Google User");
    });
  });
});
