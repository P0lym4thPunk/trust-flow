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
import { OtpDeliveryProvider, SANDBOX_PERSONAS } from "../backend/src/services/auth.service";
import {
  TrustFlowAuthController,
  createMemoryAuthStorage,
  extractEmbeddedStellarWallet,
  type AuthLifecycleStage,
  type PrivyUserLike,
} from "../src/lib/auth/privyLifecycle";
import type { WalletAccount } from "../src/lib/stellar/wallet";
import {
  EXPECTED_TEST_PRIVY_USER_ID,
  EXPECTED_TEST_PUBLIC_KEY_HEX,
  EXPECTED_TEST_STELLAR_ADDRESS,
  EXPECTED_TEST_WALLET_ID,
  TEST_HASH_HEX,
  TEST_HASH_LABEL,
  bytesToHex,
  executeNonBroadcastSigningTest,
  getTestHashBytes,
  sanitizeSigningError,
  validateTestSigningEligibility,
  verifyRawHashEd25519Signature,
} from "../src/lib/auth/privySigningTest";

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf-8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signRsaJwt(
  payload: Record<string, unknown>,
  privateKeyPem: string,
  kid = "google-test-kid-1"
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

async function startStep2TestServer(options: {
  tempDir: string;
  privyUsers?: Map<string, Record<string, unknown>>;
  privyAppId?: string;
  privyAppSecret?: string;
  privyVerificationKey?: string | null;
  googleClientId?: string | null;
  googlePublicJwk?: Record<string, unknown> | null;
  otpDelivery?: OtpDeliveryProvider;
  allowDevSandbox?: boolean;
  onCreatePrivyWallet?: (privySub: string) => string | undefined;
}) {
  const privyAppId = options.privyAppId ?? "cm_app_trustflow_test";
  const privyAppSecret = options.privyAppSecret ?? "privy-secret-server-only";
  const privyUsers = options.privyUsers ?? new Map<string, Record<string, unknown>>();

  let privyApiLookupCount = 0;
  let privyWalletCreateCount = 0;

  const backendFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method || (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET") || "GET").toUpperCase();

    if (url.startsWith("https://www.googleapis.com/oauth2/v3/certs") && options.googlePublicJwk) {
      return new Response(JSON.stringify({ keys: [options.googlePublicJwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.startsWith("https://api.privy.io/v1/users/")) {
      privyApiLookupCount += 1;
      const sub = decodeURIComponent(url.split("/v1/users/")[1] || "");
      const record = privyUsers.get(sub);
      if (!record) {
        return new Response(JSON.stringify({ error: "User not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(record), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.startsWith("https://api.privy.io/v1/wallets") && method === "GET") {
      const parsedUrl = new URL(url);
      const userId = parsedUrl.searchParams.get("user_id") || "";
      const userRecord = privyUsers.get(userId);
      const linked = Array.isArray((userRecord as any)?.linked_accounts)
        ? ((userRecord as any).linked_accounts as Array<Record<string, unknown>>)
        : [];
      const wallets = linked
        .filter(
          (acc) =>
            acc.type === "wallet" &&
            acc.chain_type === "stellar" &&
            acc.wallet_client_type === "privy"
        )
        .map((acc, idx) => ({
          id: typeof acc.id === "string" ? acc.id : `pw-existing-${idx}`,
          address: acc.address,
          chain_type: "stellar",
          owner_id: userId,
          created_at: 1760000000,
        }));
      return new Response(JSON.stringify({ data: wallets, next_cursor: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url === "https://api.privy.io/v1/wallets" && method === "POST") {
      const body =
        typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, any>) : {};
      const userId = typeof body?.owner?.user_id === "string" ? body.owner.user_id : "";
      const record = privyUsers.get(userId);
      if (!record) {
        return new Response(JSON.stringify({ error: "User not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      privyWalletCreateCount += 1;
      const address = options.onCreatePrivyWallet?.(userId) || Keypair.random().publicKey();
      const walletId = `pw-created-${privyWalletCreateCount}`;
      const existingLinked = Array.isArray((record as any).linked_accounts)
        ? ((record as any).linked_accounts as Array<Record<string, unknown>>)
        : [];
      (record as any).linked_accounts = [
        ...existingLinked,
        makePrivyApiWallet(address, { id: walletId }),
      ];

      return new Response(
        JSON.stringify({
          id: walletId,
          address,
          chain_type: "stellar",
          owner_id: userId,
          external_id: body.external_id ?? null,
          created_at: Math.floor(Date.now() / 1000),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response("Not Found", { status: 404 });
  };

  const cfg = getRuntimeConfig({
    dataDir: options.tempDir,
    allowDevSandbox: options.allowDevSandbox ?? true,
  });
  cfg.auth.privyAppId = privyAppId;
  cfg.auth.privyAppSecret = privyAppSecret;
  cfg.auth.privyVerificationKey = options.privyVerificationKey ?? null;
  cfg.auth.googleClientId = options.googleClientId ?? null;

  const backend = createBackendApp({
    config: cfg,
    otpDelivery: options.otpDelivery,
    fetchFn: backendFetch,
  });

  const server = http.createServer(backend.app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    privyAppId,
    privyUsers,
    getPrivyApiLookupCount: () => privyApiLookupCount,
    getPrivyWalletCreateCount: () => privyWalletCreateCount,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function createObservedFetch(options: {
  onPrivySync?: (
    body: Record<string, unknown>,
    callIndex: number
  ) => Promise<Response | undefined> | Response | undefined | void;
}) {
  const privySyncBodies: Array<Record<string, unknown>> = [];
  const urlsCalled: string[] = [];

  const fetchFn: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    urlsCalled.push(url);

    if (url.endsWith("/api/auth/privy-sync")) {
      const parsedBody =
        typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      privySyncBodies.push(parsedBody);
      if (options.onPrivySync) {
        const overrideRes = await options.onPrivySync(parsedBody, privySyncBodies.length);
        if (overrideRes) {
          return overrideRes;
        }
      }
    }

    return globalThis.fetch(input, init);
  };

  return {
    fetchFn,
    privySyncBodies,
    urlsCalled,
  };
}

describe("TrustFlow Step 2: Frontend Auth Lifecycle & Embedded Stellar Wallet Retrieval", () => {
  let tempDir: string;
  let ecPrivateKeyPem: string;
  let ecPublicKeyPem: string;
  const activeClosers: Array<() => Promise<void>> = [];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trustflow-step2-"));
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

  it("extractEmbeddedStellarWallet strictly selects single valid embedded wallet and rejects multiples/externals", () => {
    const addr1 = Keypair.random().publicKey();
    const addr2 = Keypair.random().publicKey();
    const externalAddr = Keypair.random().publicKey();

    assert.deepStrictEqual(extractEmbeddedStellarWallet(null), {
      status: "missing",
      sawExternalStellarWallet: false,
    });

    assert.deepStrictEqual(
      extractEmbeddedStellarWallet({
        id: "did:privy:u-ext",
        linkedAccounts: [
          {
            type: "wallet",
            chainType: "stellar",
            address: externalAddr,
            walletClientType: "freighter",
            connectorType: "injected",
          },
        ],
      }),
      { status: "missing", sawExternalStellarWallet: true }
    );

    assert.deepStrictEqual(
      extractEmbeddedStellarWallet({
        id: "did:privy:u-ok",
        linkedAccounts: [
          {
            type: "wallet",
            chainType: "ethereum",
            address: "0x1111111111111111111111111111111111111111",
            walletClientType: "privy",
            connectorType: "embedded",
          },
          {
            type: "wallet",
            chainType: "stellar",
            address: externalAddr,
            walletClientType: "freighter",
            connectorType: "injected",
          },
          makeClientPrivyWallet(addr1),
        ],
      }),
      { status: "found", address: addr1 }
    );

    assert.deepStrictEqual(
      extractEmbeddedStellarWallet({
        id: "did:privy:u-multi",
        linkedAccounts: [makeClientPrivyWallet(addr1), makeClientPrivyWallet(addr2)],
      }),
      { status: "multiple", addresses: [addr1, addr2] }
    );

    const invalidLookup = extractEmbeddedStellarWallet({
      id: "did:privy:u-bad",
      linkedAccounts: [makeClientPrivyWallet("NOT_A_STELLAR_KEY")],
    });
    assert.strictEqual(invalidLookup.status, "invalid");
  });

  it("Test A: New Email OTP user via Privy provisions embedded wallet server-side once and enters authenticated workspace", async () => {
    const newWalletAddr = Keypair.random().publicKey();
    const privySub = "did:privy:new-email-user";

    const privyUsers = new Map<string, Record<string, unknown>>([
      [
        privySub,
        {
          id: privySub,
          linked_accounts: [
            { type: "email", address: "new.alice@example.com", verified_at: 1760000000 },
          ],
        },
      ],
    ]);

    const srv = await startStep2TestServer({
      tempDir,
      privyUsers,
      privyVerificationKey: ecPublicKeyPem,
      onCreatePrivyWallet: () => newWalletAddr,
    });
    activeClosers.push(srv.close);

    const observed = createObservedFetch({});
    const storage = createMemoryAuthStorage();
    const controller = new TrustFlowAuthController({
      isPrivyConfigured: true,
      fetchFn: observed.fetchFn,
      storage,
      apiBaseUrl: srv.baseUrl,
      hydrationWaitMs: 60,
      hydrationPollMs: 15,
    });

    const stages: AuthLifecycleStage[] = [];
    controller.subscribe((s) => {
      if (stages[stages.length - 1] !== s.stage) {
        stages.push(s.stage);
      }
    });

    let sentEmail = "";
    let verifiedCode = "";
    let refreshUserCalls = 0;

    let currentPrivyUser: PrivyUserLike | null = null;
    const token = signEs256Jwt(
      { iss: "privy.io", sub: privySub, aud: srv.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 },
      ecPrivateKeyPem
    );

    controller.setRuntimeActions({
      adapter: {
        async sendEmailCode(email) {
          sentEmail = email;
        },
        async verifyEmailCode(code) {
          verifiedCode = code;
          // Privy logs user in without an embedded wallet yet
          currentPrivyUser = { id: privySub, linkedAccounts: [] };
          controller.updatePrivySnapshot({
            ready: true,
            authenticated: true,
            user: currentPrivyUser,
          });
        },
        async loginWithOAuth() {},
        async disconnect() {},
        onProviderAuthChange() {
          return () => {};
        },
      },
      getAccessToken: async () => token,
      refreshUser: async () => {
        refreshUserCalls += 1;
        return currentPrivyUser;
      },
      logout: async () => {},
    });

    await controller.initSession();
    controller.updatePrivySnapshot({ ready: true, authenticated: false, user: null });

    await controller.sendOtpCode("new.alice@example.com");
    assert.strictEqual(sentEmail, "new.alice@example.com");

    await controller.verifyOtpCode("new.alice@example.com", "654321");
    assert.strictEqual(verifiedCode, "654321");
    assert.strictEqual(srv.getPrivyWalletCreateCount(), 1, "New user should trigger server wallet provisioning once");
    assert.strictEqual(observed.privySyncBodies.length, 1);
    assert.ok(refreshUserCalls >= 2, "Best-effort refreshUser runs after server provisioning");

    // Ensure frontend does NOT send spoofable email/displayName fields
    assert.deepStrictEqual(Object.keys(observed.privySyncBodies[0]).sort(), ["accessToken"]);

    const state = controller.getState();
    assert.strictEqual(state.stage, "authenticated");
    assert.strictEqual(state.isAuthenticated, true);
    assert.strictEqual(state.user?.email, "new.alice@example.com");
    assert.strictEqual(state.user?.stellarAddress, newWalletAddr);
    assert.strictEqual(state.user?.walletCustody, "privy_embedded");
    assert.ok(storage.getItem("trustflow_auth_token")?.startsWith("tf-sess-"));

    assert.ok(stages.includes("wallet_loading"));
    assert.ok(stages.includes("backend_syncing"));
    assert.strictEqual(stages[stages.length - 1], "authenticated");

    // Repeated snapshot after auth must not provision another wallet or re-sync
    controller.updatePrivySnapshot({
      ready: true,
      authenticated: true,
      user: {
        id: privySub,
        linkedAccounts: [makeClientPrivyWallet(newWalletAddr)],
      },
    });
    await new Promise((r) => setTimeout(r, 30));
    assert.strictEqual(srv.getPrivyWalletCreateCount(), 1);
    assert.strictEqual(observed.privySyncBodies.length, 1);
  });

  it("Test B: Returning Email OTP user retrieves existing wallet with zero createWallet calls and reloads cleanly", async () => {
    const existingAddr = Keypair.random().publicKey();
    const privySub = "did:privy:returning-email-user";

    const privyUsers = new Map<string, Record<string, unknown>>([
      [
        privySub,
        {
          id: privySub,
          linked_accounts: [
            { type: "email", address: "returning@example.com", verified_at: 1760000000 },
            makePrivyApiWallet(existingAddr),
          ],
        },
      ],
    ]);

    const srv = await startStep2TestServer({
      tempDir,
      privyUsers,
      privyVerificationKey: ecPublicKeyPem,
    });
    activeClosers.push(srv.close);

    const observed = createObservedFetch({});
    const storage = createMemoryAuthStorage();
    const token = signEs256Jwt(
      { iss: "privy.io", sub: privySub, aud: srv.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 },
      ecPrivateKeyPem
    );

    let createWalletCalls = 0;
    const privyUserObj: PrivyUserLike = {
      id: privySub,
      linkedAccounts: [makeClientPrivyWallet(existingAddr)],
    };

    const controller = new TrustFlowAuthController({
      isPrivyConfigured: true,
      fetchFn: observed.fetchFn,
      storage,
      apiBaseUrl: srv.baseUrl,
      hydrationWaitMs: 60,
      hydrationPollMs: 15,
    });

    controller.setRuntimeActions({
      adapter: {
        async sendEmailCode() {},
        async verifyEmailCode() {
          controller.updatePrivySnapshot({
            ready: true,
            authenticated: true,
            user: privyUserObj,
          });
        },
        async loginWithOAuth() {},
        async disconnect() {},
        onProviderAuthChange() {
          return () => {};
        },
      },
      getAccessToken: async () => token,
      refreshUser: async () => privyUserObj,
    });

    await controller.initSession();
    controller.updatePrivySnapshot({ ready: true, authenticated: false, user: null });
    await controller.verifyOtpCode("returning@example.com", "112233");

    assert.strictEqual(srv.getPrivyWalletCreateCount(), 0);
    assert.strictEqual(observed.privySyncBodies.length, 1);
    assert.strictEqual(controller.getState().stage, "authenticated");
    assert.strictEqual(controller.getState().user?.stellarAddress, existingAddr);

    // Simulate browser page reload with stored token + Privy still ready
    const observedReload = createObservedFetch({});
    const reloaded = new TrustFlowAuthController({
      isPrivyConfigured: true,
      fetchFn: observedReload.fetchFn,
      storage,
      apiBaseUrl: srv.baseUrl,
      hydrationWaitMs: 60,
      hydrationPollMs: 15,
    });
    reloaded.setRuntimeActions({
      getAccessToken: async () => token,
    });
    await reloaded.initSession();
    reloaded.updatePrivySnapshot({ ready: true, authenticated: true, user: privyUserObj });
    await new Promise((r) => setTimeout(r, 30));

    assert.strictEqual(reloaded.getState().stage, "authenticated");
    assert.strictEqual(reloaded.getState().user?.stellarAddress, existingAddr);
    assert.strictEqual(srv.getPrivyWalletCreateCount(), 0);
    assert.strictEqual(observedReload.privySyncBodies.length, 0, "Reload with valid matching session restores via /api/auth/me");
  });

  it("Test C: Google OAuth redirect return completes hydration and backend sync without a second login", async () => {
    const googleAddr = Keypair.random().publicKey();
    const privySub = "did:privy:google-oauth-user";

    const privyUsers = new Map<string, Record<string, unknown>>([
      [
        privySub,
        {
          id: privySub,
          linked_accounts: [
            {
              type: "google_oauth",
              email: "google.user@example.com",
              name: "Google Alice",
              verified_at: 1760000000,
            },
            makePrivyApiWallet(googleAddr),
          ],
        },
      ],
    ]);

    const srv = await startStep2TestServer({
      tempDir,
      privyUsers,
      privyVerificationKey: ecPublicKeyPem,
    });
    activeClosers.push(srv.close);

    const observed = createObservedFetch({});
    const storage = createMemoryAuthStorage();
    const token = signEs256Jwt(
      { iss: "privy.io", sub: privySub, aud: srv.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 },
      ecPrivateKeyPem
    );

    let loginWithOAuthCalls = 0;

    // Fresh controller after redirect reload (no TrustFlow JWT yet)
    const controller = new TrustFlowAuthController({
      isPrivyConfigured: true,
      fetchFn: observed.fetchFn,
      storage,
      apiBaseUrl: srv.baseUrl,
      hydrationWaitMs: 80,
      hydrationPollMs: 15,
    });

    controller.setRuntimeActions({
      adapter: {
        async sendEmailCode() {},
        async verifyEmailCode() {},
        async loginWithOAuth() {
          loginWithOAuthCalls += 1;
        },
        async disconnect() {},
        onProviderAuthChange() {
          return () => {};
        },
      },
      getAccessToken: async () => token,
      refreshUser: async () => ({
        id: privySub,
        linkedAccounts: [makeClientPrivyWallet(googleAddr)],
      }),
    });

    await controller.initSession();
    assert.strictEqual(controller.getState().stage, "initializing");

    // Privy completes redirect callback asynchronously
    controller.handleAdapterAuthSignal({ authenticated: true, address: googleAddr });
    controller.updatePrivySnapshot({
      ready: true,
      authenticated: true,
      user: {
        id: privySub,
        linkedAccounts: [makeClientPrivyWallet(googleAddr)],
      },
    });

    await new Promise((r) => setTimeout(r, 80));

    assert.strictEqual(loginWithOAuthCalls, 0, "No second manual Google login may be required");
    assert.strictEqual(srv.getPrivyWalletCreateCount(), 0);
    assert.strictEqual(observed.privySyncBodies.length, 1);

    const state = controller.getState();
    assert.strictEqual(state.stage, "authenticated");
    assert.strictEqual(state.isAuthenticated, true);
    assert.strictEqual(state.user?.email, "google.user@example.com");
    assert.strictEqual(state.user?.displayName, "Google Alice");
    assert.strictEqual(state.user?.stellarAddress, googleAddr);
  });

  it("Test D: Wallet retrieval waits for delayed linkedAccounts hydration instead of calling createWallet prematurely", async () => {
    const existingAddr = Keypair.random().publicKey();
    const privySub = "did:privy:delayed-hydration-user";

    const privyUsers = new Map<string, Record<string, unknown>>([
      [
        privySub,
        {
          id: privySub,
          linked_accounts: [
            { type: "email", address: "delayed@example.com", verified_at: 1760000000 },
            makePrivyApiWallet(existingAddr),
          ],
        },
      ],
    ]);

    const srv = await startStep2TestServer({
      tempDir,
      privyUsers,
      privyVerificationKey: ecPublicKeyPem,
    });
    activeClosers.push(srv.close);

    const observed = createObservedFetch({});
    const storage = createMemoryAuthStorage();
    const token = signEs256Jwt(
      { iss: "privy.io", sub: privySub, aud: srv.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 },
      ecPrivateKeyPem
    );

    let refreshUserCalls = 0;

    const controller = new TrustFlowAuthController({
      isPrivyConfigured: true,
      fetchFn: observed.fetchFn,
      storage,
      apiBaseUrl: srv.baseUrl,
      hydrationWaitMs: 400,
      hydrationPollMs: 15,
    });

    controller.setRuntimeActions({
      getAccessToken: async () => token,
      refreshUser: async () => {
        refreshUserCalls += 1;
        // Return empty first so reactive delayed linkedAccounts update is exercised
        return { id: privySub, linkedAccounts: [] };
      },
    });

    await controller.initSession();

    // Step 1: Privy becomes ready & authenticated with empty linkedAccounts initially
    controller.updatePrivySnapshot({
      ready: true,
      authenticated: true,
      user: { id: privySub, linkedAccounts: [] },
    });

    // Step 2: 75ms later, Privy React SDK finishes hydrating linkedAccounts
    setTimeout(() => {
      controller.updatePrivySnapshot({
        ready: true,
        authenticated: true,
        user: {
          id: privySub,
          linkedAccounts: [makeClientPrivyWallet(existingAddr)],
        },
      });
    }, 75);

    await new Promise((r) => setTimeout(r, 220));

    assert.ok(refreshUserCalls >= 1);
    assert.strictEqual(srv.getPrivyWalletCreateCount(), 0, "Delayed hydration must prevent duplicate provisioning");
    assert.strictEqual(observed.privySyncBodies.length, 1);
    assert.strictEqual(controller.getState().stage, "authenticated");
    assert.strictEqual(controller.getState().user?.stellarAddress, existingAddr);
  });

  it("Test E: Rapid duplicate Privy/adapter events collapse into a single in-flight privy-sync request", async () => {
    const existingAddr = Keypair.random().publicKey();
    const privySub = "did:privy:dedup-user";

    const privyUsers = new Map<string, Record<string, unknown>>([
      [
        privySub,
        {
          id: privySub,
          linked_accounts: [
            { type: "email", address: "dedup@example.com", verified_at: 1760000000 },
            makePrivyApiWallet(existingAddr),
          ],
        },
      ],
    ]);

    const srv = await startStep2TestServer({
      tempDir,
      privyUsers,
      privyVerificationKey: ecPublicKeyPem,
    });
    activeClosers.push(srv.close);

    const observed = createObservedFetch({});
    const storage = createMemoryAuthStorage();
    const token = signEs256Jwt(
      { iss: "privy.io", sub: privySub, aud: srv.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 },
      ecPrivateKeyPem
    );

    const controller = new TrustFlowAuthController({
      isPrivyConfigured: true,
      fetchFn: observed.fetchFn,
      storage,
      apiBaseUrl: srv.baseUrl,
      hydrationWaitMs: 60,
      hydrationPollMs: 15,
    });

    controller.setRuntimeActions({
      getAccessToken: async () => token,
      refreshUser: async () => ({
        id: privySub,
        linkedAccounts: [makeClientPrivyWallet(existingAddr)],
      }),
    });

    await controller.initSession();

    const snap = {
      ready: true,
      authenticated: true,
      user: {
        id: privySub,
        linkedAccounts: [makeClientPrivyWallet(existingAddr)],
      },
    };

    // Rapid fire bursts simulating multiple re-renders + adapter callbacks
    controller.handleAdapterAuthSignal({ authenticated: true, address: existingAddr });
    controller.updatePrivySnapshot(snap);
    controller.updatePrivySnapshot(snap);
    controller.handleAdapterAuthSignal({ authenticated: true, address: existingAddr });
    void controller.syncPrivySession({ allowWalletProvision: true });
    controller.updatePrivySnapshot(snap);

    await new Promise((r) => setTimeout(r, 120));

    assert.strictEqual(observed.privySyncBodies.length, 1, "Must execute exactly 1 privy-sync POST");
    assert.strictEqual(controller.getState().stage, "authenticated");
  });

  it("Test F: Backend sync failure preserves Privy session, blocks authenticated workspace, and recovers on retry without re-creating wallets", async () => {
    const existingAddr = Keypair.random().publicKey();
    const privySub = "did:privy:sync-fail-user";

    const privyUsers = new Map<string, Record<string, unknown>>([
      [
        privySub,
        {
          id: privySub,
          linked_accounts: [
            { type: "email", address: "retry@example.com", verified_at: 1760000000 },
            makePrivyApiWallet(existingAddr),
          ],
        },
      ],
    ]);

    const srv = await startStep2TestServer({
      tempDir,
      privyUsers,
      privyVerificationKey: ecPublicKeyPem,
    });
    activeClosers.push(srv.close);

    let forceOutage = true;
    let privyLogoutCalls = 0;

    const observed = createObservedFetch({
      onPrivySync: async () => {
        if (forceOutage) {
          return new Response(
            JSON.stringify({
              code: "PRIVY_API_RATE_LIMITED",
              error: "Temporary verification outage",
            }),
            { status: 503, headers: { "Content-Type": "application/json" } }
          );
        }
        return undefined;
      },
    });

    const storage = createMemoryAuthStorage();
    const token = signEs256Jwt(
      { iss: "privy.io", sub: privySub, aud: srv.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 },
      ecPrivateKeyPem
    );

    const controller = new TrustFlowAuthController({
      isPrivyConfigured: true,
      fetchFn: observed.fetchFn,
      storage,
      apiBaseUrl: srv.baseUrl,
      hydrationWaitMs: 60,
      hydrationPollMs: 15,
    });

    controller.setRuntimeActions({
      getAccessToken: async () => token,
      refreshUser: async () => ({
        id: privySub,
        linkedAccounts: [makeClientPrivyWallet(existingAddr)],
      }),
      logout: async () => {
        privyLogoutCalls += 1;
      },
    });

    await controller.initSession();
    controller.updatePrivySnapshot({
      ready: true,
      authenticated: true,
      user: {
        id: privySub,
        linkedAccounts: [makeClientPrivyWallet(existingAddr)],
      },
    });

    await new Promise((r) => setTimeout(r, 80));

    const failedState = controller.getState();
    assert.strictEqual(failedState.stage, "sync_failed");
    assert.strictEqual(failedState.isAuthenticated, false);
    assert.strictEqual(failedState.user, null);
    assert.strictEqual(failedState.syncError?.canRetrySync, true);
    assert.strictEqual(failedState.syncError?.requiresReauth, false);
    assert.strictEqual(storage.getItem("trustflow_auth_token"), null);
    assert.strictEqual(privyLogoutCalls, 0, "Transient backend error must preserve Privy login for retry");

    // Backend recovers -> retry succeeds
    forceOutage = false;
    await controller.retryPrivySync();

    const recoveredState = controller.getState();
    assert.strictEqual(recoveredState.stage, "authenticated");
    assert.strictEqual(recoveredState.isAuthenticated, true);
    assert.strictEqual(recoveredState.syncError, null);
    assert.strictEqual(recoveredState.user?.stellarAddress, existingAddr);
    assert.strictEqual(srv.getPrivyWalletCreateCount(), 0, "Retry must not attempt wallet creation");
    assert.strictEqual(observed.privySyncBodies.length, 2);
  });

  it("Test G: External-only wallet never masquerades as embedded wallet and obeys provisioning guard", async () => {
    const freighterAddr = Keypair.random().publicKey();
    const privySub = "did:privy:external-only-user";

    const srv = await startStep2TestServer({
      tempDir,
      privyUsers: new Map([
        [
          privySub,
          {
            id: privySub,
            linked_accounts: [
              {
                type: "wallet",
                chain_type: "stellar",
                address: freighterAddr,
                wallet_client_type: "freighter",
                connector_type: "injected",
                verified_at: 1760000000,
              },
            ],
          },
        ],
      ]),
      privyVerificationKey: ecPublicKeyPem,
    });
    activeClosers.push(srv.close);

    const observed = createObservedFetch({});
    const storage = createMemoryAuthStorage();
    const token = signEs256Jwt(
      { iss: "privy.io", sub: privySub, aud: srv.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 },
      ecPrivateKeyPem
    );

    const controller = new TrustFlowAuthController({
      isPrivyConfigured: true,
      disableAutoWalletProvision: true,
      isProduction: false,
      fetchFn: observed.fetchFn,
      storage,
      apiBaseUrl: srv.baseUrl,
      hydrationWaitMs: 60,
      hydrationPollMs: 15,
    });

    const externalOnlyUser: PrivyUserLike = {
      id: privySub,
      linkedAccounts: [
        {
          type: "wallet",
          chainType: "stellar",
          address: freighterAddr,
          walletClientType: "freighter",
          connectorType: "injected",
        },
      ],
    };

    controller.setRuntimeActions({
      getAccessToken: async () => token,
      refreshUser: async () => externalOnlyUser,
    });

    await controller.initSession();
    controller.updatePrivySnapshot({
      ready: true,
      authenticated: true,
      user: externalOnlyUser,
    });

    await new Promise((r) => setTimeout(r, 150));

    const state = controller.getState();
    assert.strictEqual(srv.getPrivyWalletCreateCount(), 0);
    assert.strictEqual(observed.privySyncBodies.length, 0, "Must never call privy-sync with only an external wallet when auto-provision is disabled");
    assert.strictEqual(state.stage, "sync_failed");
    assert.strictEqual(state.isAuthenticated, false);
    assert.strictEqual(state.syncError?.code, "NO_EMBEDDED_STELLAR_WALLET");
    assert.strictEqual(storage.getItem("trustflow_auth_token"), null);

    // Even when auto-provisioning is enabled on server, Freighter address is NEVER accepted as the embedded wallet
    const autoProvisionController = new TrustFlowAuthController({
      isPrivyConfigured: true,
      fetchFn: observed.fetchFn,
      storage: createMemoryAuthStorage(),
      apiBaseUrl: srv.baseUrl,
      hydrationWaitMs: 50,
      hydrationPollMs: 15,
    });
    autoProvisionController.setRuntimeActions({
      getAccessToken: async () => token,
      refreshUser: async () => externalOnlyUser,
    });
    await autoProvisionController.initSession();
    autoProvisionController.updatePrivySnapshot({
      ready: true,
      authenticated: true,
      user: externalOnlyUser,
    });
    await new Promise((r) => setTimeout(r, 120));

    assert.strictEqual(autoProvisionController.getState().stage, "authenticated");
    assert.notStrictEqual(autoProvisionController.getState().user?.stellarAddress, freighterAddr);
    assert.strictEqual(srv.getPrivyWalletCreateCount(), 1);
  });

  it("Test H: Switching from User A to User B clears stale User A session, token, and wallet before syncing User B", async () => {
    const addrA = Keypair.random().publicKey();
    const addrB = Keypair.random().publicKey();
    const subA = "did:privy:user-alpha";
    const subB = "did:privy:user-beta";

    const privyUsers = new Map<string, Record<string, unknown>>([
      [
        subA,
        {
          id: subA,
          linked_accounts: [
            { type: "email", address: "alpha@example.com", verified_at: 1760000000 },
            makePrivyApiWallet(addrA),
          ],
        },
      ],
      [
        subB,
        {
          id: subB,
          linked_accounts: [
            { type: "email", address: "beta@example.com", verified_at: 1760000000 },
            makePrivyApiWallet(addrB),
          ],
        },
      ],
    ]);

    const srv = await startStep2TestServer({
      tempDir,
      privyUsers,
      privyVerificationKey: ecPublicKeyPem,
    });
    activeClosers.push(srv.close);

    const observed = createObservedFetch({});
    const storage = createMemoryAuthStorage();

    let activeToken = signEs256Jwt(
      { iss: "privy.io", sub: subA, aud: srv.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 },
      ecPrivateKeyPem
    );
    let currentPrivyUser: PrivyUserLike = {
      id: subA,
      linkedAccounts: [makeClientPrivyWallet(addrA)],
    };

    const controller = new TrustFlowAuthController({
      isPrivyConfigured: true,
      fetchFn: observed.fetchFn,
      storage,
      apiBaseUrl: srv.baseUrl,
      hydrationWaitMs: 60,
      hydrationPollMs: 15,
    });

    controller.setRuntimeActions({
      getAccessToken: async () => activeToken,
      refreshUser: async () => currentPrivyUser,
      logout: async () => {},
    });

    await controller.initSession();
    controller.updatePrivySnapshot({
      ready: true,
      authenticated: true,
      user: currentPrivyUser,
    });
    await new Promise((r) => setTimeout(r, 80));

    const tokenA = storage.getItem("trustflow_auth_token");
    assert.ok(tokenA);
    assert.strictEqual(controller.getState().user?.email, "alpha@example.com");
    assert.strictEqual(controller.getState().user?.stellarAddress, addrA);

    // Switch directly to User B (e.g., after session change / another tab login)
    activeToken = signEs256Jwt(
      { iss: "privy.io", sub: subB, aud: srv.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 },
      ecPrivateKeyPem
    );
    currentPrivyUser = {
      id: subB,
      linkedAccounts: [makeClientPrivyWallet(addrB)],
    };

    controller.updatePrivySnapshot({
      ready: true,
      authenticated: true,
      user: currentPrivyUser,
    });
    await new Promise((r) => setTimeout(r, 100));

    const tokenB = storage.getItem("trustflow_auth_token");
    assert.ok(tokenB);
    assert.notStrictEqual(tokenB, tokenA);
    assert.strictEqual(controller.getState().stage, "authenticated");
    assert.strictEqual(controller.getState().user?.email, "beta@example.com");
    assert.strictEqual(controller.getState().user?.stellarAddress, addrB);
    assert.strictEqual(controller.getState().user?.providerSubject, subB);
  });

  it("Test I: Logout clears TrustFlow session, Privy session, storage token, and revokes backend token", async () => {
    const walletAddr = Keypair.random().publicKey();
    const privySub = "did:privy:logout-user";

    const privyUsers = new Map<string, Record<string, unknown>>([
      [
        privySub,
        {
          id: privySub,
          linked_accounts: [
            { type: "email", address: "logout@example.com", verified_at: 1760000000 },
            makePrivyApiWallet(walletAddr),
          ],
        },
      ],
    ]);

    const srv = await startStep2TestServer({
      tempDir,
      privyUsers,
      privyVerificationKey: ecPublicKeyPem,
    });
    activeClosers.push(srv.close);

    const observed = createObservedFetch({});
    const storage = createMemoryAuthStorage();
    const token = signEs256Jwt(
      { iss: "privy.io", sub: privySub, aud: srv.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 },
      ecPrivateKeyPem
    );

    let privyLogoutCalls = 0;
    const controller = new TrustFlowAuthController({
      isPrivyConfigured: true,
      fetchFn: observed.fetchFn,
      storage,
      apiBaseUrl: srv.baseUrl,
      hydrationWaitMs: 60,
      hydrationPollMs: 15,
    });

    controller.setRuntimeActions({
      getAccessToken: async () => token,
      refreshUser: async () => ({
        id: privySub,
        linkedAccounts: [makeClientPrivyWallet(walletAddr)],
      }),
      logout: async () => {
        privyLogoutCalls += 1;
      },
    });

    await controller.initSession();
    controller.updatePrivySnapshot({
      ready: true,
      authenticated: true,
      user: {
        id: privySub,
        linkedAccounts: [makeClientPrivyWallet(walletAddr)],
      },
    });
    await new Promise((r) => setTimeout(r, 80));

    const issuedSessionToken = storage.getItem("trustflow_auth_token");
    assert.ok(issuedSessionToken);
    assert.strictEqual(controller.getState().isAuthenticated, true);

    await controller.logout();

    assert.strictEqual(privyLogoutCalls, 1);
    assert.strictEqual(storage.getItem("trustflow_auth_token"), null);
    assert.strictEqual(controller.getState().stage, "unauthenticated");
    assert.strictEqual(controller.getState().isAuthenticated, false);
    assert.strictEqual(controller.getState().user, null);
    assert.strictEqual(controller.getState().wallet, null);

    // Revoked TrustFlow session token must no longer authenticate /api/agreements
    const protectedRes = await fetch(`${srv.baseUrl}/api/agreements`, {
      headers: { Authorization: `Bearer ${issuedSessionToken}` },
    });
    assert.strictEqual(protectedRes.status, 401);
  });

  it("Test J: Existing standalone Email OTP, Google ID token, and Development Sandbox authentication remain intact", async () => {
    const sentCodes: Array<{ email: string; code: string }> = [];
    const rsaKeys = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const publicJwk = crypto.createPublicKey(rsaKeys.publicKey).export({ format: "jwk" }) as Record<
      string,
      unknown
    >;
    publicJwk.kid = "google-test-kid-1";
    publicJwk.alg = "RS256";
    publicJwk.use = "sig";

    const srv = await startStep2TestServer({
      tempDir,
      googleClientId: "trustflow-google-client-id",
      googlePublicJwk: publicJwk,
      allowDevSandbox: true,
      otpDelivery: {
        isConfigured: () => true,
        async sendOtp(email, code) {
          sentCodes.push({ email, code });
        },
      },
    });
    activeClosers.push(srv.close);

    // 1. Standalone Email OTP
    const otpController = new TrustFlowAuthController({
      isPrivyConfigured: false,
      storage: createMemoryAuthStorage(),
      apiBaseUrl: srv.baseUrl,
    });
    await otpController.initSession();
    assert.strictEqual(otpController.getState().capabilities.emailOtpConfigured, true);
    assert.strictEqual(otpController.getState().capabilities.googleConfigured, true);

    await otpController.sendOtpCode("standalone@example.com");
    assert.strictEqual(sentCodes.length, 1);
    await otpController.verifyOtpCode("standalone@example.com", sentCodes[0].code);
    assert.strictEqual(otpController.getState().isAuthenticated, true);
    assert.strictEqual(otpController.getState().user?.provider, "email_otp");
    assert.strictEqual(otpController.getState().user?.email, "standalone@example.com");
    await otpController.logout();

    // 2. Standalone Google ID token
    const googleController = new TrustFlowAuthController({
      isPrivyConfigured: false,
      storage: createMemoryAuthStorage(),
      apiBaseUrl: srv.baseUrl,
    });
    await googleController.initSession();
    const googleIdToken = signRsaJwt(
      {
        iss: "https://accounts.google.com",
        aud: "trustflow-google-client-id",
        sub: "google-sub-123",
        email: "google.direct@example.com",
        email_verified: true,
        name: "Direct Google",
        exp: Math.floor(Date.now() / 1000) + 600,
      },
      rsaKeys.privateKey
    );
    await googleController.loginWithGoogle(googleIdToken);
    assert.strictEqual(googleController.getState().isAuthenticated, true);
    assert.strictEqual(googleController.getState().user?.provider, "google");
    assert.strictEqual(googleController.getState().user?.email, "google.direct@example.com");
    await googleController.logout();

    // 3. Development Sandbox
    const sandboxController = new TrustFlowAuthController({
      isPrivyConfigured: false,
      storage: createMemoryAuthStorage(),
      apiBaseUrl: srv.baseUrl,
    });
    await sandboxController.initSession();
    await sandboxController.enterSandbox("alice");
    assert.strictEqual(sandboxController.getState().isAuthenticated, true);
    assert.strictEqual(sandboxController.getState().user?.provider, "dev_sandbox");
    assert.strictEqual(sandboxController.getState().user?.isSandbox, true);
    assert.ok(sandboxController.getState().user?.stellarAddress);
  });

  it("Test K (Phase 2.2A): Alice/Bob/Charlie demo switching works cleanly without invoking Privy wallet creation", async () => {
    const srv = await startStep2TestServer({
      tempDir,
      allowDevSandbox: true,
    });
    activeClosers.push(srv.close);

    const controller = new TrustFlowAuthController({
      isPrivyConfigured: true,
      defaultDevSandboxEnabled: true,
      disableAutoWalletProvision: true,
      isProduction: false,
      storage: createMemoryAuthStorage(),
      apiBaseUrl: srv.baseUrl,
    });

    controller.setRuntimeActions({});

    await controller.initSession();
    controller.updatePrivySnapshot({ ready: true, authenticated: false, user: null });

    const simulatedProfiles: WalletAccount[] = (["alice", "bob", "charlie"] as const).map(
      (k) => ({
        address: SANDBOX_PERSONAS[k].stellarAddress,
        displayName: SANDBOX_PERSONAS[k].displayName,
        role: SANDBOX_PERSONAS[k].roleLabel,
        avatar: SANDBOX_PERSONAS[k].avatar,
        balanceXLM: "0.00",
        balanceUSDC: "0.00",
        isSimulated: true,
      })
    );

    for (const [idx, key] of (["alice", "bob", "charlie"] as const).entries()) {
      await controller.enterSandbox(key);
      const state = controller.getState();
      const effective = TrustFlowAuthController.buildEffectiveAccount(
        state.user,
        state.wallet,
        simulatedProfiles
      );
      assert.strictEqual(state.isAuthenticated, true);
      assert.strictEqual(state.user?.provider, "dev_sandbox");
      assert.strictEqual(state.user?.isSandbox, true);
      assert.strictEqual(state.user?.stellarAddress, simulatedProfiles[idx].address);
      assert.strictEqual(effective?.isSimulated, true);
      assert.strictEqual(effective?.provider, "simulated");
      assert.strictEqual(effective?.address, simulatedProfiles[idx].address);
    }

    assert.strictEqual(srv.getPrivyWalletCreateCount(), 0);
  });

  it("Test L (Phase 2.2A): Privy Email OTP completes with test guard active, preserves Privy identity, and skips wallet creation", async () => {
    const privySub = "did:privy:phase22a-test-user";
    const srv = await startStep2TestServer({
      tempDir,
      privyUsers: new Map([
        [
          privySub,
          {
            id: privySub,
            linked_accounts: [{ type: "email", address: "phase22a.test@example.com", verified_at: 1760000000 }],
          },
        ],
      ]),
      privyVerificationKey: ecPublicKeyPem,
    });
    activeClosers.push(srv.close);

    const token = signEs256Jwt(
      { iss: "privy.io", sub: privySub, aud: srv.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 },
      ecPrivateKeyPem
    );

    const observed = createObservedFetch({});
    const controller = new TrustFlowAuthController({
      isPrivyConfigured: true,
      disableAutoWalletProvision: true,
      isProduction: false,
      fetchFn: observed.fetchFn,
      storage: createMemoryAuthStorage(),
      apiBaseUrl: srv.baseUrl,
      hydrationWaitMs: 60,
      hydrationPollMs: 15,
    });

    let refreshUserCalls = 0;
    let emailOtpVerified = false;
    const privyUserObj: PrivyUserLike = {
      id: privySub,
      linkedAccounts: [{ type: "email", address: "phase22a.test@example.com" }],
    };

    controller.setRuntimeActions({
      adapter: {
        sendEmailCode: async () => {},
        verifyEmailCode: async () => {
          emailOtpVerified = true;
          controller.updatePrivySnapshot({
            ready: true,
            authenticated: true,
            user: privyUserObj,
          });
        },
        loginWithOAuth: async () => {},
        disconnect: async () => {},
      },
      getAccessToken: async () => token,
      refreshUser: async () => {
        refreshUserCalls += 1;
        return privyUserObj;
      },
    });

    await controller.initSession();
    controller.updatePrivySnapshot({ ready: true, authenticated: false, user: null });

    await controller.sendOtpCode("phase22a.test@example.com");
    await assert.rejects(
      () => controller.verifyOtpCode("phase22a.test@example.com", "123456"),
      /Privy Wallet Test Mode is active/i
    );

    assert.strictEqual(emailOtpVerified, true);
    assert.strictEqual(controller.isAutoWalletProvisionDisabled(), true);
    assert.strictEqual(srv.getPrivyWalletCreateCount(), 0);
    assert.ok(refreshUserCalls >= 1);
    assert.strictEqual(observed.privySyncBodies.length, 0);

    const state = controller.getState();
    assert.strictEqual(state.autoWalletProvisionDisabled, true);
    assert.strictEqual(state.stage, "sync_failed");
    assert.strictEqual(state.activePrivySub, privySub);
    assert.strictEqual(state.syncError?.code, "NO_EMBEDDED_STELLAR_WALLET");
    assert.strictEqual(state.syncError?.privySub, privySub);
    assert.strictEqual(state.user, null);
  });

  it("Test M (Phase 2.2A): Repeated auth updates, retries, and explicit allowWalletProvision cannot bypass test guard", async () => {
    const privySub = "did:privy:phase22a-no-bypass";
    const srv = await startStep2TestServer({
      tempDir,
      privyUsers: new Map(),
      privyVerificationKey: ecPublicKeyPem,
    });
    activeClosers.push(srv.close);

    const token = signEs256Jwt(
      { iss: "privy.io", sub: privySub, aud: srv.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 },
      ecPrivateKeyPem
    );

    const controller = new TrustFlowAuthController({
      isPrivyConfigured: true,
      disableAutoWalletProvision: true,
      isProduction: false,
      storage: createMemoryAuthStorage(),
      apiBaseUrl: srv.baseUrl,
      hydrationWaitMs: 50,
      hydrationPollMs: 15,
    });

    const privyUserObj: PrivyUserLike = {
      id: privySub,
      linkedAccounts: [{ type: "email", address: "nobypass@example.com" }],
    };

    controller.setRuntimeActions({
      getAccessToken: async () => token,
      refreshUser: async () => privyUserObj,
    });

    await controller.initSession();

    // Repeated snapshot updates and adapter auth signals
    for (let i = 0; i < 4; i++) {
      controller.updatePrivySnapshot({
        ready: true,
        authenticated: true,
        user: { ...privyUserObj },
      });
      controller.handleAdapterAuthSignal({ authenticated: true, address: null });
    }
    await new Promise((r) => setTimeout(r, 90));

    assert.strictEqual(srv.getPrivyWalletCreateCount(), 0);
    assert.strictEqual(controller.getState().activePrivySub, privySub);

    // Explicit syncPrivySession({ allowWalletProvision: true }) and retryPrivySync() must still be blocked
    await assert.rejects(
      () => controller.syncPrivySession({ allowWalletProvision: true }),
      /Privy Wallet Test Mode is active/i
    );
    await assert.rejects(
      () => controller.retryPrivySync(),
      /Privy Wallet Test Mode is active/i
    );
    assert.strictEqual(srv.getPrivyWalletCreateCount(), 0);
  });

  it("Test N (Phase 2.2A): Production safety prevents test guard activation and preserves normal server wallet provisioning", async () => {
    const newWalletAddr = Keypair.random().publicKey();
    const privySub = "did:privy:prod-safety-user";

    const privyUsers = new Map<string, Record<string, unknown>>([
      [
        privySub,
        {
          id: privySub,
          linked_accounts: [
            { type: "email", address: "prod.safe@example.com", verified_at: 1760000000 },
          ],
        },
      ],
    ]);

    const srv = await startStep2TestServer({
      tempDir,
      privyUsers,
      privyVerificationKey: ecPublicKeyPem,
      onCreatePrivyWallet: () => newWalletAddr,
    });
    activeClosers.push(srv.close);

    const token = signEs256Jwt(
      { iss: "privy.io", sub: privySub, aud: srv.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 },
      ecPrivateKeyPem
    );

    // Even if disableAutoWalletProvision: true is passed, isProduction: true MUST refuse to enable the guard
    const controller = new TrustFlowAuthController({
      isPrivyConfigured: true,
      disableAutoWalletProvision: true,
      isProduction: true,
      storage: createMemoryAuthStorage(),
      apiBaseUrl: srv.baseUrl,
      hydrationWaitMs: 50,
      hydrationPollMs: 15,
    });

    assert.strictEqual(controller.isAutoWalletProvisionDisabled(), false);
    assert.strictEqual(controller.getState().autoWalletProvisionDisabled, false);

    controller.setRuntimeActions({
      getAccessToken: async () => token,
      refreshUser: async () => ({ id: privySub, linkedAccounts: [] }),
    });

    await controller.initSession();
    controller.updatePrivySnapshot({
      ready: true,
      authenticated: true,
      user: { id: privySub, linkedAccounts: [] },
    });
    await new Promise((r) => setTimeout(r, 120));

    assert.strictEqual(srv.getPrivyWalletCreateCount(), 1);
    assert.strictEqual(controller.getState().stage, "authenticated");
    assert.strictEqual(controller.getState().user?.stellarAddress, newWalletAddr);
  });

  it("Test O (Phase 2.2A Step 6): Dev signing test eligibility enforces production lock and exact test identity/wallet", () => {
    const validUser: PrivyUserLike = {
      id: EXPECTED_TEST_PRIVY_USER_ID,
      linkedAccounts: [
        {
          id: EXPECTED_TEST_WALLET_ID,
          type: "wallet",
          chainType: "stellar",
          address: EXPECTED_TEST_STELLAR_ADDRESS,
          walletClientType: "privy",
          connectorType: "embedded",
          recoveryMethod: "privy-v2",
          userCanSign: true,
          imported: false,
          publicKey: EXPECTED_TEST_PUBLIC_KEY_HEX,
        },
      ],
    };

    const ok = validateTestSigningEligibility({
      isProd: false,
      viteWalletTestMode: true,
      controllerTestMode: true,
      privyReady: true,
      privyAuthenticated: true,
      privyUser: validUser,
    });
    assert.strictEqual(ok.eligible, true);
    if (ok.eligible) {
      assert.strictEqual(ok.walletId, EXPECTED_TEST_WALLET_ID);
      assert.strictEqual(ok.address, EXPECTED_TEST_STELLAR_ADDRESS);
    }

    // Blocked in production even if everything else matches
    assert.strictEqual(
      validateTestSigningEligibility({
        isProd: true,
        viteWalletTestMode: true,
        controllerTestMode: true,
        privyReady: true,
        privyAuthenticated: true,
        privyUser: validUser,
      }).eligible,
      false
    );

    // Blocked when test mode flag is false
    assert.strictEqual(
      validateTestSigningEligibility({
        isProd: false,
        viteWalletTestMode: false,
        controllerTestMode: true,
        privyReady: true,
        privyAuthenticated: true,
        privyUser: validUser,
      }).eligible,
      false
    );

    // Blocked for any other Privy user
    assert.strictEqual(
      validateTestSigningEligibility({
        isProd: false,
        viteWalletTestMode: true,
        controllerTestMode: true,
        privyReady: true,
        privyAuthenticated: true,
        privyUser: { ...validUser, id: "did:privy:someone-else" },
      }).eligible,
      false
    );

    // Blocked for mismatched wallet ID
    assert.strictEqual(
      validateTestSigningEligibility({
        isProd: false,
        viteWalletTestMode: true,
        controllerTestMode: true,
        privyReady: true,
        privyAuthenticated: true,
        privyUser: {
          id: EXPECTED_TEST_PRIVY_USER_ID,
          linkedAccounts: [
            {
              ...(validUser.linkedAccounts![0] as Record<string, unknown>),
              id: "other-wallet-id",
            },
          ],
        },
      }).eligible,
      false
    );
  });

  it("Test P (Phase 2.2A Step 6): Local Ed25519 signature verification validates genuine 32-byte hash signatures and rejects invalid ones", () => {
    const hashBytes = getTestHashBytes();
    assert.strictEqual(hashBytes.length, 32);
    const expectedSha = crypto.createHash("sha256").update(TEST_HASH_LABEL, "utf8").digest();
    assert.strictEqual(bytesToHex(hashBytes), expectedSha.toString("hex"));

    const kp = Keypair.random();
    const validSig = kp.sign(hashBytes);
    const validSigHex = `0x${Buffer.from(validSig).toString("hex")}`;

    const pass = verifyRawHashEd25519Signature({
      signatureHex: validSigHex,
      expectedAddress: kp.publicKey(),
      hashBytes,
    });
    assert.strictEqual(pass.signatureValid, true);
    assert.strictEqual(pass.verifiedPublicKey, kp.publicKey());
    assert.strictEqual(pass.signatureByteLength, 64);

    // Wrong public key fails
    const otherKp = Keypair.random();
    const wrongKey = verifyRawHashEd25519Signature({
      signatureHex: validSigHex,
      expectedAddress: otherKp.publicKey(),
      hashBytes,
    });
    assert.strictEqual(wrongKey.signatureValid, false);

    // Tampered signature byte fails
    const tamperedSig = Buffer.from(validSig);
    tamperedSig[0] ^= 0xff;
    const tampered = verifyRawHashEd25519Signature({
      signatureHex: `0x${tamperedSig.toString("hex")}`,
      expectedAddress: kp.publicKey(),
      hashBytes,
    });
    assert.strictEqual(tampered.signatureValid, false);

    // Missing 0x prefix / wrong length fails
    const badFormat = verifyRawHashEd25519Signature({
      signatureHex: Buffer.from(validSig).toString("hex"),
      expectedAddress: kp.publicKey(),
      hashBytes,
    });
    assert.strictEqual(badFormat.signatureValid, false);
  });

  it("Test Q (Phase 2.2A Step 6): executeNonBroadcastSigningTest invokes signRawHash with expected args, fails closed on mismatch, and sanitizes errors", async () => {
    const validUser: PrivyUserLike = {
      id: EXPECTED_TEST_PRIVY_USER_ID,
      linkedAccounts: [
        {
          id: EXPECTED_TEST_WALLET_ID,
          type: "wallet",
          chainType: "stellar",
          address: EXPECTED_TEST_STELLAR_ADDRESS,
          walletClientType: "privy",
          connectorType: "embedded",
          recoveryMethod: "privy-v2",
          userCanSign: true,
          imported: false,
          publicKey: EXPECTED_TEST_PUBLIC_KEY_HEX,
        },
      ],
    };

    const calls: Array<{ address: string; chainType: string; hash: string }> = [];
    const fakeSigForExpectedKey = `0x${"ab".repeat(64)}` as const;

    // Resolving a non-matching signature must report signingSucceeded: true AND localVerificationPassed: false
    const mismatchRes = await executeNonBroadcastSigningTest({
      eligibilityInput: {
        isProd: false,
        viteWalletTestMode: true,
        controllerTestMode: true,
        privyReady: true,
        privyAuthenticated: true,
        privyUser: validUser,
      },
      signRawHash: async (input) => {
        calls.push(input);
        return { signature: fakeSigForExpectedKey };
      },
    });

    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0], {
      address: EXPECTED_TEST_STELLAR_ADDRESS,
      chainType: "stellar",
      hash: TEST_HASH_HEX,
    });
    assert.strictEqual(mismatchRes.signingSucceeded, true);
    assert.strictEqual(mismatchRes.localVerificationPassed, false);
    assert.match(mismatchRes.error || "", /failed local cryptographic verification/i);

    // Error sanitization removes Bearer tokens and JWTs
    const errRes = await executeNonBroadcastSigningTest({
      eligibilityInput: {
        isProd: false,
        viteWalletTestMode: true,
        controllerTestMode: true,
        privyReady: true,
        privyAuthenticated: true,
        privyUser: validUser,
      },
      signRawHash: async () => {
        throw new Error(
          "Privy error with Bearer secret-token-123 and eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signaturepart"
        );
      },
    });
    assert.strictEqual(errRes.signingSucceeded, false);
    assert.strictEqual(errRes.localVerificationPassed, false);
    assert.ok(!errRes.error?.includes("secret-token-123"));
    assert.ok(!errRes.error?.includes("eyJhbGci"));
    assert.strictEqual(
      sanitizeSigningError("Bearer abc.def"),
      "Bearer [redacted]"
    );
  });
});
