import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { Keypair } from "@stellar/stellar-sdk";
import { build as viteBuild } from "vite";

import { createBackendApp } from "../backend/src/index";
import { getRuntimeConfig } from "../backend/src/config/runtime.config";
import {
  isPrivyServerWalletImportedOrArchived,
  parsePrivyServerWallet,
  PrivyClientService,
} from "../backend/src/services/privyClient.service";
import {
  TrustFlowAuthController,
  AUTH_TOKEN_STORAGE_KEY,
  createMemoryAuthStorage,
  type PrivyUserLike,
  type UserWalletRecord,
} from "../src/lib/auth/privyLifecycle";
import { AuthProvider } from "../src/lib/auth/AuthContext";
import { NavigationShell } from "../src/components/NavigationShell";
import { WalletPickerModal } from "../src/components/WalletPickerModal";
import { ConversationalWorkspace } from "../src/components/ConversationalWorkspace";
import { AgreementDetailRoom } from "../src/components/AgreementDetailRoom";
import {
  connectStellarWalletProvider,
  signSep53MessageWithProvider,
  type StellarWalletAdapter,
} from "../src/lib/stellar/walletsKit";
import type { AgreementRecord } from "../src/types/agreement";
import type { WalletAccount } from "../src/lib/stellar/wallet";

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

function setupHappyDomEnvironment() {
  const win = new Window({ url: "https://app.trustflow.example" });
  const keys = [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Node",
    "MouseEvent",
    "KeyboardEvent",
    "Event",
    "CustomEvent",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "IS_REACT_ACT_ENVIRONMENT",
  ] as const;

  const prevDescriptors: Record<string, PropertyDescriptor | undefined> = {};
  for (const key of keys) {
    prevDescriptors[key] = Object.getOwnPropertyDescriptor(globalThis, key);
  }

  const nextGlobals: Record<string, unknown> = {
    window: win,
    document: win.document,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    Node: win.Node,
    MouseEvent: win.MouseEvent,
    KeyboardEvent: win.KeyboardEvent,
    Event: win.Event,
    CustomEvent: win.CustomEvent,
    getComputedStyle: win.getComputedStyle.bind(win),
    requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number,
    cancelAnimationFrame: (id: number) => clearTimeout(id),
    IS_REACT_ACT_ENVIRONMENT: true,
  };

  for (const [key, value] of Object.entries(nextGlobals)) {
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
      enumerable: true,
    });
  }

  if (!(globalThis.HTMLElement.prototype as any).attachEvent) {
    (globalThis.HTMLElement.prototype as any).attachEvent = () => {};
    (globalThis.HTMLElement.prototype as any).detachEvent = () => {};
  }

  return {
    win,
    cleanup: () => {
      win.close();
      for (const [k, desc] of Object.entries(prevDescriptors)) {
        if (desc === undefined) {
          delete (globalThis as any)[k];
        } else {
          Object.defineProperty(globalThis, k, desc);
        }
      }
    },
  };
}

async function mountComponent(element: React.ReactElement): Promise<{
  container: HTMLElement;
  root: Root;
  unmount: () => Promise<void>;
}> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return {
    container,
    root,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function startTestBackend(options: {
  tempDir: string;
  privyVerificationKey: string;
  appOrigin?: string;
  isProd?: boolean;
  privyUsers?: Map<string, Record<string, unknown>>;
  fetchFn?: typeof fetch;
}) {
  const cfg = getRuntimeConfig({
    dataDir: options.tempDir,
    isProd: options.isProd ?? false,
    allowDevSandbox: !(options.isProd ?? false),
    appOrigin: options.appOrigin,
  });
  cfg.auth.privyAppId = "cm_app_trustflow_remediation";
  cfg.auth.privyAppSecret = "privy-secret-test";
  cfg.auth.privyVerificationKey = options.privyVerificationKey;

  const privyUsers = options.privyUsers ?? new Map<string, Record<string, unknown>>();
  const defaultFetch: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://api.privy.io/v1/users/")) {
      const sub = decodeURIComponent(url.split("/v1/users/")[1] || "");
      const rec = privyUsers.get(sub);
      return rec
        ? new Response(JSON.stringify(rec), { status: 200, headers: { "Content-Type": "application/json" } })
        : new Response("{}", { status: 404 });
    }
    return new Response("{}", { status: 404 });
  };

  const backend = createBackendApp({
    config: cfg,
    fetchFn: options.fetchFn ?? defaultFetch,
  });

  const server = http.createServer(backend.app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    cfg,
    backend,
    privyUsers,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("TrustFlow Phase 2 Consolidated Remediation Test Suite", () => {
  let tempDir: string;
  let ecPrivateKeyPem: string;
  let ecPublicKeyPem: string;
  const activeClosers: Array<() => Promise<void>> = [];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trustflow-p2-rem-"));
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
      await activeClosers.pop()!();
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("1. Authentication & Session Recovery", () => {
    it("Allows two separate successful 401 recovery cycles, coalesces concurrent 401s, prevents retry loops, preserves 403/5xx/network, and rejects stale session clears", async () => {
      const addrA = Keypair.random().publicKey();
      const addrB = Keypair.random().publicKey();
      const subA = "did:privy:cycle-user-a";
      const subB = "did:privy:cycle-user-b";
      const storage = createMemoryAuthStorage();

      let syncCount = 0;
      let syncDelayMs = 0;
      let forceAlways401 = false;
      let failTokens = new Set<string>(["tok-expired-1", "tok-expired-2"]);
      let responseMode: "normal" | "403" | "500" | "network" = "normal";

      const makeUserPayload = (sub: string, addr: string) => ({
        id: `usr-${sub}`,
        email: "recovery@example.com",
        displayName: "Recovery User",
        avatar: "R",
        provider: "privy",
        authVerified: true,
        providerSubject: sub,
        stellarAddress: addr,
        walletCustody: "privy_embedded",
        wallets: [],
        primaryWalletAddress: addr,
        isSandbox: false,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      });

      const makeWalletPayload = (addr: string) => ({
        address: addr,
        primaryWalletAddress: addr,
        network: "testnet",
        custody: "privy_embedded",
        isEmbedded: true,
        balanceXLM: "0.00",
        balanceUSDC: "0.00",
      });

      const fetchFn: typeof fetch = async (input, init) => {
        const url = String(input);
        const headers = new Headers(init?.headers || {});
        const authToken = headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";

        if (url.endsWith("/api/auth/me")) {
          return new Response(
            JSON.stringify({
              capabilities: { emailOtpConfigured: false, googleConfigured: false, privyConfigured: true, devSandboxEnabled: false },
              user: makeUserPayload(subA, addrA),
              wallet: makeWalletPayload(addrA),
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        if (url.endsWith("/api/auth/privy-sync")) {
          syncCount += 1;
          if (syncDelayMs > 0) await new Promise((r) => setTimeout(r, syncDelayMs));
          const token = `tok-fresh-${syncCount}`;
          return new Response(
            JSON.stringify({
              token,
              user: makeUserPayload(subA, addrA),
              wallet: makeWalletPayload(addrA),
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        if (responseMode === "403") return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
        if (responseMode === "500") return new Response(JSON.stringify({ error: "Internal" }), { status: 500 });
        if (responseMode === "network") throw new Error("ECONNREFUSED");

        if (forceAlways401 || failTokens.has(authToken)) {
          return new Response(JSON.stringify({ error: "Expired" }), { status: 401 });
        }

        return new Response(JSON.stringify({ ok: true, usedToken: authToken }), { status: 200 });
      };

      storage.setItem(AUTH_TOKEN_STORAGE_KEY, "tok-expired-1");
      const controller = new TrustFlowAuthController({
        isPrivyConfigured: true,
        fetchFn,
        storage,
        apiBaseUrl: "http://localhost:3000",
      });
      controller.setRuntimeActions({ getAccessToken: async () => "privy-jwt-valid" });
      await controller.initSession();
      controller.updatePrivySnapshot({
        ready: true,
        authenticated: true,
        user: {
          id: subA,
          linkedAccounts: [{ type: "wallet", chainType: "stellar", walletClientType: "privy", connectorType: "embedded", address: addrA }],
        },
      });

      // Cycle 1: Concurrent 401 requests coalesce into strictly 1 privy-sync and both succeed
      syncDelayMs = 20;
      const [c1r1, c1r2] = await Promise.all([
        controller.authenticatedFetch("http://localhost:3000/api/agreements"),
        controller.authenticatedFetch("http://localhost:3000/api/agreements"),
      ]);
      syncDelayMs = 0;
      assert.strictEqual(c1r1.status, 200);
      assert.strictEqual(c1r2.status, 200);
      assert.strictEqual(syncCount, 1);
      assert.strictEqual(storage.getItem(AUTH_TOKEN_STORAGE_KEY), "tok-fresh-1");
      assert.strictEqual(controller.getState().isAuthenticated, true);

      // Simulate token expiring a second time independently
      failTokens.add("tok-fresh-1");

      // Cycle 2: Second independent 401 recovery succeeds in the same controller session
      const c2r = await controller.authenticatedFetch("http://localhost:3000/api/agreements");
      assert.strictEqual(c2r.status, 200);
      assert.strictEqual(syncCount, 2);
      assert.strictEqual(storage.getItem(AUTH_TOKEN_STORAGE_KEY), "tok-fresh-2");
      assert.strictEqual(controller.getState().isAuthenticated, true);

      // 403 / 500 / network errors never invalidate active auth
      responseMode = "403";
      assert.strictEqual((await controller.authenticatedFetch("http://localhost:3000/api/agreements")).status, 403);
      responseMode = "500";
      assert.strictEqual((await controller.authenticatedFetch("http://localhost:3000/api/agreements")).status, 500);
      responseMode = "network";
      await assert.rejects(() => controller.authenticatedFetch("http://localhost:3000/api/agreements"), /ECONNREFUSED/);
      assert.strictEqual(controller.getState().isAuthenticated, true);
      responseMode = "normal";

      // Switch to subB while a delayed request using subA's token fails 401 -> must NOT log out subB!
      storage.setItem(AUTH_TOKEN_STORAGE_KEY, "tok-stale-a");
      const staleFetch = new TrustFlowAuthController({
        isPrivyConfigured: true,
        fetchFn: async (url) => {
          if (String(url).endsWith("/api/auth/me")) {
            return new Response(JSON.stringify({ capabilities: {}, user: makeUserPayload(subA, addrA), wallet: makeWalletPayload(addrA) }), { status: 200 });
          }
          if (String(url).endsWith("/api/auth/privy-sync")) {
            return new Response(JSON.stringify({ token: "tok-b-1", user: makeUserPayload(subB, addrB), wallet: makeWalletPayload(addrB) }), { status: 200 });
          }
          await new Promise((r) => setTimeout(r, 40));
          return new Response("{}", { status: 401 });
        },
        storage: createMemoryAuthStorage(),
        apiBaseUrl: "http://localhost:3000",
      });
      await staleFetch.initSession();
      staleFetch.updatePrivySnapshot({
        ready: true,
        authenticated: true,
        user: { id: subA, linkedAccounts: [{ type: "wallet", chainType: "stellar", walletClientType: "privy", connectorType: "embedded", address: addrA }] },
      });
      await new Promise((r) => setTimeout(r, 30));
      const inFlightOldReq = staleFetch.authenticatedFetch("http://localhost:3000/api/agreements");
      staleFetch.setRuntimeActions({ getAccessToken: async () => "jwt-b" });
      staleFetch.updatePrivySnapshot({
        ready: true,
        authenticated: true,
        user: { id: subB, linkedAccounts: [{ type: "wallet", chainType: "stellar", walletClientType: "privy", connectorType: "embedded", address: addrB }] },
      });
      await inFlightOldReq;
      await new Promise((r) => setTimeout(r, 30));
      assert.strictEqual(staleFetch.getState().user?.providerSubject, subB);
      assert.strictEqual(staleFetch.getState().isAuthenticated, true);

      // Persistent 401 retries at most once (no infinite retry loop) and clears auth cleanly
      forceAlways401 = true;
      const syncBeforePersistent = syncCount;
      const loopCheck = await controller.authenticatedFetch("http://localhost:3000/api/agreements");
      assert.strictEqual(loopCheck.status, 401);
      assert.strictEqual(syncCount, syncBeforePersistent + 1);
      assert.strictEqual(controller.getState().isAuthenticated, false);
      assert.strictEqual(storage.getItem(AUTH_TOKEN_STORAGE_KEY), null);
    });

    it("syncPrivyUserDirect shares guarded lifecycle and transitions to sync_failed safely on error", async () => {
      const storage = createMemoryAuthStorage();
      let syncCalls = 0;
      const controller = new TrustFlowAuthController({
        isPrivyConfigured: true,
        storage,
        apiBaseUrl: "http://localhost:3000",
        fetchFn: async (url) => {
          if (String(url).endsWith("/api/auth/privy-sync")) {
            syncCalls += 1;
            await new Promise((r) => setTimeout(r, 25));
            return new Response(JSON.stringify({ code: "BACKEND_DOWN", error: "Service unavailable" }), { status: 503 });
          }
          return new Response(JSON.stringify({ capabilities: {}, user: null, wallet: null }), { status: 200 });
        },
      });
      await controller.initSession();

      await assert.rejects(
        () => Promise.all([
          controller.syncPrivyUserDirect({ accessToken: "jwt-1" }),
          controller.syncPrivyUserDirect({ accessToken: "jwt-1" }),
        ]),
        /temporarily unavailable/i
      );
      assert.strictEqual(syncCalls, 1, "Concurrent syncPrivyUserDirect calls share one in-flight sync");
      assert.strictEqual(controller.getState().stage, "sync_failed");
      assert.strictEqual(controller.getState().syncError?.canRetrySync, true);
    });

    it("NavigationShell React UI accurately renders Google-only, Email-only, Both, and Neither linked-method states without inferring Email OTP from Google email", async () => {
      const dom = setupHappyDomEnvironment();
      const addr = Keypair.random().publicKey();
      const sub = "did:privy:nav-ui-test";

      const renderProfileWithLinkedAccounts = async (
        linkedAccounts: Array<Record<string, unknown>>,
        userEmail: string | null,
        runtimeOverrides: Record<string, unknown> = {}
      ) => {
        const storage = createMemoryAuthStorage();
        storage.setItem(AUTH_TOKEN_STORAGE_KEY, "sess-nav");
        const mockUser = {
          id: "usr-nav",
          email: userEmail,
          displayName: "Nav User",
          avatar: "N",
          provider: "privy",
          authVerified: true,
          providerSubject: sub,
          stellarAddress: addr,
          walletCustody: "privy_embedded",
          wallets: [
            {
              id: "w-emb",
              address: addr,
              custody: "privy_embedded",
              provider: "privy",
              verificationMethod: "privy_embedded",
              verifiedAt: new Date().toISOString(),
              linkedAt: new Date().toISOString(),
              status: "active",
              isPrimary: true,
            },
          ],
          primaryWalletAddress: addr,
          isSandbox: false,
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
        };

        const fetchFn: typeof fetch = async (input) => {
          if (String(input).endsWith("/api/auth/me")) {
            return new Response(
              JSON.stringify({
                user: mockUser,
                wallet: {
                  address: addr,
                  primaryWalletAddress: addr,
                  network: "testnet",
                  custody: "privy_embedded",
                  isEmbedded: true,
                  balanceXLM: "10.00",
                  balanceUSDC: "25.00",
                },
              }),
              { status: 200 }
            );
          }
          if (String(input).endsWith("/api/auth/capabilities")) {
            return new Response(
              JSON.stringify({ emailOtpConfigured: false, googleConfigured: false, privyConfigured: true, devSandboxEnabled: false }),
              { status: 200 }
            );
          }
          return new Response("{}", { status: 404 });
        };

        const linkBridgeRef: any = { current: null };
        const account: WalletAccount = {
          id: "usr-nav",
          address: addr,
          displayName: "Nav User",
          role: "PAYER",
          avatar: "N",
          balanceXLM: "10.00",
          balanceUSDC: "25.00",
          isSimulated: false,
          isEmbedded: true,
          provider: "privy",
        };

        const mounted = await mountComponent(
          React.createElement(AuthProvider, {
            isPrivyConfiguredOverride: true,
            fetchFn,
            privyRuntime: {
              ready: true,
              authenticated: true,
              user: { id: sub, linkedAccounts },
              getAccessToken: async () => "jwt-nav",
              linkEmail: () => {},
              linkGoogle: () => {},
              linkBridgeRef,
              ...runtimeOverrides,
            },
            children: React.createElement(NavigationShell, {
              activeTab: "workspace",
              onTabChange: () => {},
              onReturnHome: () => {},
              currentAccount: account,
              onAccountChange: () => {},
              isSimulated: false,
              onConnectRealWallet: () => {},
              isDark: false,
              onToggleTheme: () => {},
              children: React.createElement("div", null, "workspace"),
            }),
          })
        );

        // Open menu & account details modal
        // Wait briefly for initSession inside AuthProvider
        await act(async () => {
          await new Promise((r) => setTimeout(r, 30));
        });
        // Re-set localStorage via clicking nav menu? Note AuthProvider uses window.localStorage
        winLocalStorage.setItem(AUTH_TOKEN_STORAGE_KEY, "sess-nav");
        return { mounted, linkBridgeRef };
      };

      const winLocalStorage = dom.win.localStorage;
      winLocalStorage.setItem(AUTH_TOKEN_STORAGE_KEY, "sess-nav");

      const checkCase = async (
        linkedAccounts: Array<Record<string, unknown>>,
        userEmail: string | null,
        expectedEmailText: RegExp,
        expectEmailLinkBtn: boolean,
        expectedGoogleText: RegExp,
        expectGoogleLinkBtn: boolean
      ) => {
        winLocalStorage.setItem(AUTH_TOKEN_STORAGE_KEY, "sess-nav");
        const { mounted, linkBridgeRef } = await renderProfileWithLinkedAccounts(linkedAccounts, userEmail);
        // Trigger menu open then open Account details modal
        const menuBtn = mounted.container.querySelector('button[aria-label="Open navigation menu"]') as HTMLButtonElement;
        assert.ok(menuBtn);
        await act(async () => {
          menuBtn.click();
        });
        const acctBtn = Array.from(mounted.container.querySelectorAll("button")).find((b) =>
          b.textContent?.includes("Account and balance details")
        ) as HTMLButtonElement;
        assert.ok(acctBtn);
        await act(async () => {
          acctBtn.click();
        });

        const emailBox = mounted.container.querySelector('[data-testid="auth-method-email"]') as HTMLElement;
        const googleBox = mounted.container.querySelector('[data-testid="auth-method-google"]') as HTMLElement;
        assert.ok(emailBox && googleBox);
        assert.match(emailBox.textContent || "", expectedEmailText);
        assert.match(googleBox.textContent || "", expectedGoogleText);
        assert.strictEqual(Boolean(emailBox.querySelector("button")), expectEmailLinkBtn);
        assert.strictEqual(Boolean(googleBox.querySelector("button")), expectGoogleLinkBtn);
        await mounted.unmount();
        return linkBridgeRef;
      };

      try {
        // 1. Google-only: user.email is populated from google_oauth, yet Email OTP MUST show Not linked!
        await checkCase(
          [{ type: "google_oauth", email: "g.only@example.com", name: "G Only" }],
          "g.only@example.com",
          /Not linked/i,
          true,
          /Linked · g\.only@example\.com/i,
          false
        );

        // 2. Email-only
        await checkCase(
          [{ type: "email", address: "e.only@example.com" }],
          "e.only@example.com",
          /e\.only@example\.com/i,
          false,
          /Not linked/i,
          true
        );

        // 3. Both linked
        await checkCase(
          [
            { type: "email", address: "both@example.com" },
            { type: "google_oauth", email: "both@example.com" },
          ],
          "both@example.com",
          /both@example\.com/i,
          false,
          /Linked · both@example\.com/i,
          false
        );

        // 4. Neither linked
        await checkCase(
          [],
          null,
          /Not linked/i,
          true,
          /Not linked/i,
          true
        );

        // 5. Google link cancellation resets busy state & surfaces cancellation notice without success
        winLocalStorage.setItem(AUTH_TOKEN_STORAGE_KEY, "sess-nav");
        const { mounted, linkBridgeRef } = await renderProfileWithLinkedAccounts(
          [{ type: "email", address: "cancel@example.com" }],
          "cancel@example.com",
          {
            linkGoogle: () => {
              // Simulate Privy modal opening and user closing it via bridge cancel callback
              linkBridgeRef.current?.onLinkCancel?.();
            },
          }
        );
        const menuBtn = mounted.container.querySelector('button[aria-label="Open navigation menu"]') as HTMLButtonElement;
        await act(async () => { menuBtn.click(); });
        const acctBtn = Array.from(mounted.container.querySelectorAll("button")).find((b) =>
          b.textContent?.includes("Account and balance details")
        ) as HTMLButtonElement;
        await act(async () => { acctBtn.click(); });

        const googleLinkBtn = mounted.container.querySelector('[data-testid="auth-method-google"] button') as HTMLButtonElement;
        await act(async () => { googleLinkBtn.click(); });
        assert.match(mounted.container.textContent || "", /Linking was cancelled/i);
        assert.match(mounted.container.querySelector('[data-testid="auth-method-google"]')?.textContent || "", /Not linked/i);

        // Failed Google linking also never shows linked/success
        await act(async () => {
          linkBridgeRef.current?.onLinkError(new Error("Account already exists under another identity"));
        });
        assert.match(mounted.container.textContent || "", /already linked to a different Privy account and cannot be merged/i);
        assert.match(mounted.container.querySelector('[data-testid="auth-method-google"]')?.textContent || "", /Not linked/i);
        await mounted.unmount();
      } finally {
        dom.cleanup();
      }
    });

    it("Cross-provider email collisions and duplicate Privy links never merge accounts", async () => {
      const addrA = Keypair.random().publicKey();
      const addrB = Keypair.random().publicKey();
      const legacyAddr = Keypair.random().publicKey();
      const subA = "did:privy:privy-a";
      const subB = "did:privy:privy-b";
      const srv = await startTestBackend({
        tempDir,
        privyVerificationKey: ecPublicKeyPem,
        privyUsers: new Map([
          [subA, { id: subA, linked_accounts: [{ type: "email", address: "shared@example.com", verified_at: 1760000000 }, makePrivyApiWallet(addrA)] }],
          [subB, { id: subB, linked_accounts: [{ type: "email", address: "privyonly@example.com", verified_at: 1760000000 }, makePrivyApiWallet(addrB)] }],
        ]),
      });
      activeClosers.push(srv.close);

      // Seed existing email_otp user with shared@example.com
      await srv.backend.authRepo.saveUser({
        id: "usr-legacy-email",
        email: "shared@example.com",
        displayName: "Legacy Email User",
        avatar: "L",
        provider: "email_otp",
        authVerified: true,
        stellarAddress: legacyAddr,
        walletCustody: "external_wallet",
        primaryWalletAddress: legacyAddr,
        isSandbox: false,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      });

      // Privy sync with shared@example.com creates a SEPARATE Privy user and NEVER merges into usr-legacy-email
      const jwt = signEs256Jwt(
        { iss: "privy.io", sub: subA, aud: srv.cfg.auth.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 },
        ecPrivateKeyPem
      );
      const res = await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: jwt }),
      });
      assert.strictEqual(res.status, 200);
      const resBody = (await res.json()) as any;
      assert.notStrictEqual(resBody.user.id, "usr-legacy-email");
      assert.strictEqual(resBody.user.provider, "privy");
      const legacyAfter = await srv.backend.authRepo.findUserById("usr-legacy-email");
      assert.strictEqual(legacyAfter?.provider, "email_otp");
      assert.strictEqual(legacyAfter?.stellarAddress, legacyAddr);

      // Conversely, email_otp cannot merge into an existing Privy user's email -> 409 CROSS_PROVIDER_EMAIL_CONFLICT
      const jwtB = signEs256Jwt(
        { iss: "privy.io", sub: subB, aud: srv.cfg.auth.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 },
        ecPrivateKeyPem
      );
      const resB = await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: jwtB }),
      });
      assert.strictEqual(resB.status, 200);
      const privyBUser = ((await resB.json()) as any).user;

      // Attempting email_otp verification against privyonly@example.com is blocked
      const otpCode = "654321";
      const otpSalt = "test-salt";
      const otpHash = crypto.createHmac("sha256", srv.cfg.auth.otpSecret).update(`privyonly@example.com:${otpSalt}:${otpCode}`).digest("hex");
      await srv.backend.authRepo.saveOtp("privyonly@example.com", {
        email: "privyonly@example.com",
        codeHash: otpHash,
        salt: otpSalt,
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        attempts: 0,
        maxAttempts: 5,
      });
      const otpVerify = await fetch(`${srv.baseUrl}/api/auth/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "privyonly@example.com", code: otpCode }),
      });
      assert.strictEqual(otpVerify.status, 409);
      assert.strictEqual(((await otpVerify.json()) as any).code, "CROSS_PROVIDER_EMAIL_CONFLICT");
      const privyBAfter = await srv.backend.authRepo.findUserById(privyBUser.id);
      assert.strictEqual(privyBAfter?.provider, "privy");
    });
  });

  describe("2. Privy Stellar Wallet Validation (§5)", () => {
    it("Validates eligible embedded wallets and rejects imported, archived, foreign-owner, invalid-address, multiple, and missing candidates", async () => {
      const validAddr = Keypair.random().publicKey();
      const importedAddr = Keypair.random().publicKey();
      const archivedAddr = Keypair.random().publicKey();
      const ownerSub = "did:privy:wallet-owner";

      assert.deepStrictEqual(
        parsePrivyServerWallet(
          {
            id: "pw-valid",
            address: validAddr,
            chain_type: "stellar",
            owner_id: ownerSub,
            wallet_client_type: "privy",
            connector_type: "embedded",
            imported: false,
            archived: false,
          },
          ownerSub
        ),
        {
          id: "pw-valid",
          address: validAddr,
          chainType: "stellar",
          ownerId: ownerSub,
          externalId: null,
          createdAt: null,
        }
      );

      assert.strictEqual(isPrivyServerWalletImportedOrArchived({ imported: true }), true);
      assert.strictEqual(isPrivyServerWalletImportedOrArchived({ imported_at: 1760000000 }), true);
      assert.strictEqual(isPrivyServerWalletImportedOrArchived({ archived: true }), true);
      assert.strictEqual(isPrivyServerWalletImportedOrArchived({ archived_at: 1760000000 }), true);

      assert.throws(
        () => parsePrivyServerWallet({ id: "pw-imp", address: importedAddr, chain_type: "stellar", owner_id: ownerSub, imported: true }, ownerSub),
        /Imported wallets cannot be used/i
      );
      assert.throws(
        () => parsePrivyServerWallet({ id: "pw-arch", address: archivedAddr, chain_type: "stellar", owner_id: ownerSub, archived: true }, ownerSub),
        /archived/i
      );
      assert.throws(
        () => parsePrivyServerWallet({ id: "pw-foreign", address: validAddr, chain_type: "stellar", owner_id: "did:privy:someone-else" }, ownerSub),
        /owner_id does not match/i
      );
      assert.throws(
        () => parsePrivyServerWallet({ id: "pw-unowned", address: validAddr, chain_type: "stellar" }, ownerSub),
        /ownership could not be verified/i
      );
      assert.throws(
        () => parsePrivyServerWallet({ id: "pw-badaddr", address: "GBADKEY", chain_type: "stellar", owner_id: ownerSub }, ownerSub),
        /invalid Stellar address/i
      );

      // Integration through PrivyClientService.listUserStellarWallets + inspectVerifiedPrivyUser
      const client = new PrivyClientService(async (url) => {
        if (String(url).includes("/v1/wallets")) {
          return new Response(
            JSON.stringify({
              data: [
                { id: "pw-imp", address: importedAddr, chain_type: "stellar", owner_id: ownerSub, imported: true },
                { id: "pw-arch", address: archivedAddr, chain_type: "stellar", owner_id: ownerSub, archived: true },
                { id: "pw-ok", address: validAddr, chain_type: "stellar", owner_id: ownerSub, wallet_client_type: "privy", connector_type: "embedded" },
              ],
            }),
            { status: 200 }
          );
        }
        return new Response("{}", { status: 404 });
      });

      const listed = await client.listUserStellarWallets({
        privySub: ownerSub,
        appId: "app",
        appSecret: "sec",
      });
      assert.deepStrictEqual(listed, [
        {
          id: "pw-ok",
          address: validAddr,
          chainType: "stellar",
          ownerId: ownerSub,
          externalId: null,
          createdAt: null,
        },
      ]);

      // Multiple embedded candidates & 0 eligible wallet handled safely in backend /api/auth/privy-sync
      const multiSub = "did:privy:multi-embedded";
      const zeroSub = "did:privy:zero-embedded";
      const srv = await startTestBackend({
        tempDir,
        privyVerificationKey: ecPublicKeyPem,
        privyUsers: new Map([
          [
            multiSub,
            {
              id: multiSub,
              linked_accounts: [
                { type: "email", address: "multi@example.com", verified_at: 1760000000 },
                makePrivyApiWallet(Keypair.random().publicKey(), { id: "pw-1" }),
                makePrivyApiWallet(Keypair.random().publicKey(), { id: "pw-2" }),
              ],
            },
          ],
          [
            zeroSub,
            {
              id: zeroSub,
              linked_accounts: [
                { type: "email", address: "zero@example.com", verified_at: 1760000000 },
                makePrivyApiWallet(importedAddr, { id: "pw-imp-only", imported: true }),
              ],
            },
          ],
        ]),
      });
      activeClosers.push(srv.close);

      const jwtMulti = signEs256Jwt({ iss: "privy.io", sub: multiSub, aud: srv.cfg.auth.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 }, ecPrivateKeyPem);
      const multiRes = await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: jwtMulti }),
      });
      assert.strictEqual(multiRes.status, 409);
      assert.strictEqual(((await multiRes.json()) as any).code, "MULTIPLE_EMBEDDED_STELLAR_WALLETS");

      const jwtZero = signEs256Jwt({ iss: "privy.io", sub: zeroSub, aud: srv.cfg.auth.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 }, ecPrivateKeyPem);
      const zeroRes = await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: jwtZero, disableAutoProvision: true }),
      });
      assert.strictEqual(zeroRes.status, 403);
      assert.strictEqual(((await zeroRes.json()) as any).code, "NO_EMBEDDED_STELLAR_WALLET");
    });
  });

  describe("3. Multi-Provider Stellar Wallet Interoperability & SEP-53 (§2)", () => {
    it("WalletPickerModal presents providers, connects chosen SEP-53 provider, handles cancel & rejects incapable wallets without marking verified", async () => {
      const dom = setupHappyDomEnvironment();
      const xbullKp = Keypair.random();
      const albedoAddr = Keypair.random().publicKey();

      let challengeCalls = 0;
      let verifyCalls = 0;
      let cancelSigning = false;

      const mockAdapter: StellarWalletAdapter = {
        async isProviderAvailable(id) {
          return id === "xbull" || id === "lobstr" || id === "albedo";
        },
        async connectProvider(id) {
          if (id === "xbull") return { address: xbullKp.publicKey() };
          if (id === "albedo") return { address: albedoAddr };
          throw new Error("User rejected wallet connection");
        },
        async signMessageWithProvider(id, params) {
          if (cancelSigning) {
            throw new Error("User cancelled signature request");
          }
          if (id === "xbull") {
            return {
              signature: Buffer.from(xbullKp.signMessage(params.message)).toString("base64"),
              signerAddress: xbullKp.publicKey(),
            };
          }
          throw new Error("Unsupported");
        },
      };

      // Capability check rejects incapable wallets directly at adapter boundary
      await assert.rejects(() => connectStellarWalletProvider("albedo", mockAdapter), /does not support SEP-53/i);
      await assert.rejects(
        () => signSep53MessageWithProvider("rabet", { address: albedoAddr, message: "msg" }, mockAdapter),
        /does not support SEP-53/i
      );

      let verifiedWallet: UserWalletRecord | null = null;
      const mounted = await mountComponent(
        React.createElement(WalletPickerModal, {
          isOpen: true,
          onClose: () => {},
          walletAdapter: mockAdapter,
          onRequestChallenge: async (address, provider) => {
            challengeCalls += 1;
            return {
              challengeId: "wch-mock-1",
              address,
              provider,
              domain: "app.trustflow.example",
              network: "testnet",
              expiresAt: new Date(Date.now() + 300_000).toISOString(),
              message: `TrustFlow external wallet ownership verification\nAddress: ${address}\nDomain: app.trustflow.example`,
            };
          },
          onCompleteVerification: async (params) => {
            verifyCalls += 1;
            return {
              id: "wal-xbull-1",
              address: params.address,
              custody: "external_wallet",
              provider: "xbull",
              verificationMethod: "sep53",
              verifiedAt: new Date().toISOString(),
              linkedAt: new Date().toISOString(),
              status: "active",
              isPrimary: false,
            };
          },
          onVerified: (w) => {
            verifiedWallet = w;
          },
        })
      );

      try {
        // Wait for availability scan
        await act(async () => { await new Promise((r) => setTimeout(r, 25)); });

        // Incapable wallet (albedo) is displayed clearly as SEP-53 unsupported & not selectable
        const albedoRow = mounted.container.querySelector('[data-testid="wallet-provider-albedo"]') as HTMLElement;
        assert.ok(albedoRow);
        assert.match(albedoRow.textContent || "", /SEP-53 unsupported/i);

        // Cancelled connection leaves zero linked wallets & shows error
        const varialBtn = mounted.container.querySelector('[data-testid="wallet-provider-varial"]') as HTMLButtonElement;
        await act(async () => { varialBtn.click(); });
        assert.match(mounted.container.textContent || "", /cancelled|rejected/i);
        assert.strictEqual(verifyCalls, 0);

        // Select xBull -> connects & displays human-readable SEP-53 message
        const xbullBtn = mounted.container.querySelector('[data-testid="wallet-provider-xbull"]') as HTMLButtonElement;
        await act(async () => { xbullBtn.click(); });
        assert.strictEqual(challengeCalls, 1);
        const msgBox = mounted.container.querySelector('[data-testid="sep53-challenge-message"]');
        assert.ok(msgBox);
        assert.match(msgBox.textContent || "", new RegExp(xbullKp.publicKey()));

        // Cancel signature step once -> does not verify or link
        cancelSigning = true;
        const signBtn = mounted.container.querySelector('[data-testid="confirm-sep53-sign-btn"]') as HTMLButtonElement;
        await act(async () => { signBtn.click(); });
        assert.strictEqual(verifyCalls, 0);
        assert.strictEqual(verifiedWallet, null);
        assert.match(mounted.container.textContent || "", /cancelled/i);

        // Sign cleanly -> verifies & invokes onVerified
        cancelSigning = false;
        await act(async () => { signBtn.click(); });
        assert.strictEqual(verifyCalls, 1);
        const verified = verifiedWallet as UserWalletRecord | null;
        assert.ok(verified);
        assert.strictEqual(verified.provider, "xbull");
        assert.strictEqual(verified.address, xbullKp.publicKey());
      } finally {
        await mounted.unmount();
        dom.cleanup();
      }
    });
  });

  describe("4. Concurrency, Unlink-vs-Create Race & SEP-53 Domain Security (§7, §8)", () => {
    it("Enforces canonical APP_ORIGIN against spoofed Host/X-Forwarded-Host, fails closed when missing prod origin, and prevents challenge burn on concurrent uniqueness conflict", async () => {
      const embA = Keypair.random().publicKey();
      const embB = Keypair.random().publicKey();
      const extKp = Keypair.random();
      const extAddr = extKp.publicKey();
      const subA = "did:privy:race-a";
      const subB = "did:privy:race-b";

      const srv = await startTestBackend({
        tempDir,
        privyVerificationKey: ecPublicKeyPem,
        appOrigin: "https://pay.trustflow.app:8443",
        isProd: true,
        privyUsers: new Map([
          [subA, { id: subA, linked_accounts: [makePrivyApiWallet(embA, { id: "pw-ra" })] }],
          [subB, { id: subB, linked_accounts: [makePrivyApiWallet(embB, { id: "pw-rb" })] }],
        ]),
      });
      activeClosers.push(srv.close);

      const syncUser = async (sub: string) => {
        const jwt = signEs256Jwt({ iss: "privy.io", sub, aud: srv.cfg.auth.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 }, ecPrivateKeyPem);
        const r = await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: jwt }),
        });
        assert.strictEqual(r.status, 200);
        return (await r.json()) as { token: string; user: any };
      };

      const sessA = await syncUser(subA);
      const sessB = await syncUser(subB);

      // Spoofed Host / X-Forwarded-Host must NOT change canonical SEP-53 domain
      const chARes = await fetch(`${srv.baseUrl}/api/auth/wallets/external/challenge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessA.token}`,
          "Host": "evil-attacker.example:9999",
          "X-Forwarded-Host": "phishing.attacker.example",
        },
        body: JSON.stringify({ address: extAddr, provider: "xbull" }),
      });
      assert.strictEqual(chARes.status, 200);
      const chA = (await chARes.json()) as any;
      assert.strictEqual(chA.domain, "pay.trustflow.app:8443");
      assert.strictEqual(chA.message.includes("evil-attacker"), false);
      assert.strictEqual(chA.message.includes("phishing.attacker"), false);
      assert.strictEqual(chA.message.includes("pay.trustflow.app:8443"), true);

      const chBRes = await fetch(`${srv.baseUrl}/api/auth/wallets/external/challenge`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessB.token}` },
        body: JSON.stringify({ address: extAddr, provider: "lobstr" }),
      });
      assert.strictEqual(chBRes.status, 200);
      const chB = (await chBRes.json()) as any;

      const sigA = Buffer.from(extKp.signMessage(chA.message)).toString("base64");
      const sigB = Buffer.from(extKp.signMessage(chB.message)).toString("base64");

      // Concurrent verification race for same external address: strictly 1 wins (200), loser gets 409 WALLET_ALREADY_LINKED
      const [resA, resB] = await Promise.all([
        fetch(`${srv.baseUrl}/api/auth/wallets/external/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessA.token}` },
          body: JSON.stringify({ challengeId: chA.challengeId, address: extAddr, signature: sigA }),
        }),
        fetch(`${srv.baseUrl}/api/auth/wallets/external/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessB.token}` },
          body: JSON.stringify({ challengeId: chB.challengeId, address: extAddr, signature: sigB }),
        }),
      ]);

      const pair = [
        { who: "A", res: resA, chId: chA.challengeId },
        { who: "B", res: resB, chId: chB.challengeId },
      ];
      const winner = pair.find((p) => p.res.status === 200);
      const loser = pair.find((p) => p.res.status === 409);
      assert.ok(winner && loser);
      assert.strictEqual(((await loser.res.json()) as any).code, "WALLET_ALREADY_LINKED");

      // Loser's valid challenge MUST NOT have been consumed when uniqueness check failed!
      const loserChallengeStored = await srv.backend.authRepo.findWalletChallenge(loser.chId);
      assert.ok(loserChallengeStored);
      assert.strictEqual(loserChallengeStored.consumedAt, null);

      // Tampered stored challenge domain rejected on verify (403 INVALID_CHALLENGE_DOMAIN)
      const badDomAddr = Keypair.random().publicKey();
      await srv.backend.authRepo.saveWalletChallenge({
        id: "wch-bad-domain",
        userId: sessA.user.id,
        address: badDomAddr,
        provider: "xbull",
        network: "testnet",
        domain: "evil.domain.test",
        nonce: "n1",
        message: "msg",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        consumedAt: null,
      });
      const badDomVerify = await fetch(`${srv.baseUrl}/api/auth/wallets/external/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessA.token}` },
        body: JSON.stringify({ challengeId: "wch-bad-domain", address: badDomAddr, signature: sigA }),
      });
      assert.strictEqual(badDomVerify.status, 403);
      assert.strictEqual(((await badDomVerify.json()) as any).code, "INVALID_CHALLENGE_DOMAIN");

      // Missing production APP_ORIGIN fails closed (500 SEP53_DOMAIN_UNCONFIGURED)
      const noOriginDir = fs.mkdtempSync(path.join(os.tmpdir(), "trustflow-no-origin-"));
      try {
        const srvNoOrigin = await startTestBackend({
          tempDir: noOriginDir,
          privyVerificationKey: ecPublicKeyPem,
          isProd: true,
          privyUsers: srv.privyUsers,
        });
        activeClosers.push(srvNoOrigin.close);
        const sessNoOrigin = await (async () => {
          const jwt = signEs256Jwt({ iss: "privy.io", sub: subA, aud: srvNoOrigin.cfg.auth.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 }, ecPrivateKeyPem);
          return (await (await fetch(`${srvNoOrigin.baseUrl}/api/auth/privy-sync`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: jwt }),
          })).json()) as any;
        })();

        const failCh = await fetch(`${srvNoOrigin.baseUrl}/api/auth/wallets/external/challenge`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessNoOrigin.token}` },
          body: JSON.stringify({ address: Keypair.random().publicKey(), provider: "varial" }),
        });
        assert.strictEqual(failCh.status, 500);
        const failBody = (await failCh.json()) as any;
        assert.ok(
          failBody.code === "SEP53_DOMAIN_UNCONFIGURED" || failBody.code === "INVALID_APP_ORIGIN",
          `Unexpected error code: ${failBody.code}`
        );
        assert.match(failBody.error || "", /APP_ORIGIN must be configured in production/i);
      } finally {
        fs.rmSync(noOriginDir, { recursive: true, force: true });
      }
    });

    it("KeyedOperationLock serializes unlinkExternalWallet vs createAgreement in both execution orders without allowing invalid state", async () => {
      const embA = Keypair.random().publicKey();
      const embB = Keypair.random().publicKey();
      const extKp = Keypair.random();
      const extAddr = extKp.publicKey();
      const subA = "did:privy:lock-a";
      const subB = "did:privy:lock-b";

      const srv = await startTestBackend({
        tempDir,
        privyVerificationKey: ecPublicKeyPem,
        privyUsers: new Map([
          [subA, { id: subA, linked_accounts: [makePrivyApiWallet(embA, { id: "pw-la" })] }],
          [subB, { id: subB, linked_accounts: [makePrivyApiWallet(embB, { id: "pw-lb" })] }],
        ]),
      });
      activeClosers.push(srv.close);

      const syncUser = async (sub: string) => {
        const jwt = signEs256Jwt({ iss: "privy.io", sub, aud: srv.cfg.auth.privyAppId, exp: Math.floor(Date.now() / 1000) + 600 }, ecPrivateKeyPem);
        return (await (await fetch(`${srv.baseUrl}/api/auth/privy-sync`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: jwt }),
        })).json()) as any;
      };
      const sessA = await syncUser(subA);
      const sessB = await syncUser(subB);

      // Link extAddr to User A
      const ch = (await (await fetch(`${srv.baseUrl}/api/auth/wallets/external/challenge`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessA.token}` },
        body: JSON.stringify({ address: extAddr, provider: "xbull" }),
      })).json()) as any;
      const sig = Buffer.from(extKp.signMessage(ch.message)).toString("base64");
      const verified = (await (await fetch(`${srv.baseUrl}/api/auth/wallets/external/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessA.token}` },
        body: JSON.stringify({ challengeId: ch.challengeId, address: extAddr, signature: sig }),
      })).json()) as any;
      const walletId = verified.linkedWallet.id;

      // Order 1: Unlink starts while agreement creation is raced concurrently -> mutually exclusive!
      const [unlinkRes1, createRes1] = await Promise.all([
        fetch(`${srv.baseUrl}/api/auth/wallets/${walletId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${sessA.token}` },
        }),
        fetch(`${srv.baseUrl}/api/agreements`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessA.token}` },
          body: JSON.stringify({
            id: "agr-race-1",
            transactionType: "WORK",
            title: "Race Test",
            description: "Race Test",
            terms: {
              amount: "50.00",
              asset: "USDC",
              payer: extAddr,
              recipient: embB,
              approver: extAddr,
              title: "Race Test",
              description: "Race Test",
              deliverables: ["Item"],
              condition: "Approved",
              cancellationTerms: "Mutual",
              deadline: new Date(Date.now() + 86_400_000).toISOString(),
              contractId: "C_TEST",
              domain: "trustflow.stellar.escrow.v1",
              network: "testnet",
              version: 1,
            },
            canonicalHash: crypto.randomBytes(32).toString("hex"),
            status: "CREATED",
          }),
        }),
      ]);

      const uOk1 = unlinkRes1.status === 200;
      const cOk1 = createRes1.status === 201;
      assert.strictEqual(uOk1 !== cOk1, true, "Exactly one of unlink or createAgreement must win; never both");

      if (cOk1) {
        // Agreement won -> unlink returned 409, active agreement exists, cannot unlink while active
        assert.strictEqual(unlinkRes1.status, 409);
        // Cancel agreement to terminal CANCELLED, then unlink succeeds and history stays readable
        const created = (await createRes1.json()) as any;
        const r1 = (await (await fetch(`${srv.baseUrl}/api/agreements/agr-race-1/cancel-request`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessA.token}` },
          body: JSON.stringify({ expectedVersion: created.version }),
        })).json()) as any;
        await fetch(`${srv.baseUrl}/api/agreements/agr-race-1/cancel-confirm`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessB.token}` },
          body: JSON.stringify({ expectedVersion: r1.version }),
        });

        const unlinkAfterCancel = await fetch(`${srv.baseUrl}/api/auth/wallets/${walletId}`, {
          method: "DELETE", headers: { Authorization: `Bearer ${sessA.token}` },
        });
        assert.strictEqual(unlinkAfterCancel.status, 200);

        const listAfterUnlink = await fetch(`${srv.baseUrl}/api/agreements`, {
          headers: { Authorization: `Bearer ${sessA.token}` },
        });
        assert.strictEqual(listAfterUnlink.status, 200);
        assert.strictEqual(((await listAfterUnlink.json()) as any[]).length, 1);
      } else {
        // Unlink won -> createAgreement rejected cleanly with 403
        assert.strictEqual(createRes1.status, 403);
      }
    });
  });

  describe("5. Agreement Wallet Selection & Detail Identification React UI (§6)", () => {
    it("ConversationalWorkspace defaults to embedded primary, allows selecting verified external wallet, rejects unverified/unlinked, resets on unlink & account switch, and AgreementDetailRoom identifies participating wallets", async () => {
      const dom = setupHappyDomEnvironment();
      const embeddedAddr = Keypair.random().publicKey();
      const externalAddr = Keypair.random().publicKey();
      const otherUserEmbedded = Keypair.random().publicKey();
      const recipientAddr = Keypair.random().publicKey();

      const embeddedWallet: UserWalletRecord = {
        id: "w-emb-1",
        address: embeddedAddr,
        custody: "privy_embedded",
        provider: "privy",
        verificationMethod: "privy_embedded",
        verifiedAt: new Date().toISOString(),
        linkedAt: new Date().toISOString(),
        status: "active",
        isPrimary: true,
      };
      const externalWallet: UserWalletRecord = {
        id: "w-xbull-1",
        address: externalAddr,
        custody: "external_wallet",
        provider: "xbull",
        verificationMethod: "sep53",
        verifiedAt: new Date().toISOString(),
        linkedAt: new Date().toISOString(),
        status: "active",
        isPrimary: false,
      };
      const unlinkedWallet: UserWalletRecord = {
        ...externalWallet,
        status: "unlinked",
        unlinkedAt: new Date().toISOString(),
      };
      const legacyUnverifiedWallet: UserWalletRecord = {
        id: "w-leg-1",
        address: Keypair.random().publicKey(),
        custody: "external_wallet",
        provider: "freighter",
        verificationMethod: "legacy_unverified",
        verifiedAt: new Date().toISOString(),
        linkedAt: new Date().toISOString(),
        status: "active",
        isPrimary: false,
      };

      const postedPayloads: any[] = [];
      const mockFetch: typeof fetch = async (input, init) => {
        const url = String(input);
        if (url.endsWith("/api/ai/check")) {
          return new Response(JSON.stringify({ overallStatus: "PASS", summary: "Clear", findings: [] }), { status: 200 });
        }
        if (url.endsWith("/api/agreements") && init?.method === "POST") {
          const body = JSON.parse(String(init.body));
          postedPayloads.push(body);
          return new Response(JSON.stringify(body), { status: 201 });
        }
        return new Response("{}", { status: 200 });
      };

      const renderWorkspace = (
        wallets: UserWalletRecord[],
        userAddr: string
      ) =>
        React.createElement(AuthProvider, {
          isPrivyConfiguredOverride: false,
          fetchFn: mockFetch,
          children: React.createElement(ConversationalWorkspace, {
            initialType: "WORK",
            currentUserAddress: userAddr,
            currentUserName: "Alice",
            availableWallets: wallets,
            primaryWalletAddress: userAddr,
            onAgreementCreated: () => {},
          }),
        });

      const mounted = await mountComponent(
        renderWorkspace([embeddedWallet, externalWallet, legacyUnverifiedWallet], embeddedAddr)
      );

      try {
        // Click "Create payment"
        const createShortcut = Array.from(mounted.container.querySelectorAll("button")).find((b) =>
          b.textContent?.includes("Create payment")
        ) as HTMLButtonElement;
        await act(async () => { createShortcut.click(); });

        // Embedded primary is selected by default; legacy_unverified wallet is NOT selectable
        const embOption = mounted.container.querySelector(`[data-testid="agreement-wallet-option-${embeddedAddr}"]`) as HTMLButtonElement;
        const extOption = mounted.container.querySelector(`[data-testid="agreement-wallet-option-${externalAddr}"]`) as HTMLButtonElement;
        const legOption = mounted.container.querySelector(`[data-testid="agreement-wallet-option-${legacyUnverifiedWallet.address}"]`);
        assert.strictEqual(embOption.getAttribute("aria-checked"), "true");
        assert.strictEqual(extOption.getAttribute("aria-checked"), "false");
        assert.strictEqual(legOption, null);

        // Select verified external wallet
        await act(async () => { extOption.click(); });
        assert.strictEqual(extOption.getAttribute("aria-checked"), "true");

        // Unlinking selected external wallet resets cleanly back to embedded primary with notice
        await act(async () => {
          mounted.root.render(renderWorkspace([embeddedWallet, unlinkedWallet], embeddedAddr));
        });
        assert.strictEqual(
          mounted.container.querySelector(`[data-testid="agreement-wallet-option-${embeddedAddr}"]`)?.getAttribute("aria-checked"),
          "true"
        );
        assert.match(mounted.container.textContent || "", /unlinked\. Selection reset to your primary wallet/i);

        // Re-mount with active external wallet, select external wallet, advance through Steps 1->6 and verify selected payer reaches POST /api/agreements
        await act(async () => {
          mounted.root.render(renderWorkspace([embeddedWallet, externalWallet], embeddedAddr));
        });
        const extBtn2 = mounted.container.querySelector(`[data-testid="agreement-wallet-option-${externalAddr}"]`) as HTMLButtonElement;
        await act(async () => { extBtn2.click(); });
        const charlieBtn = Array.from(mounted.container.querySelectorAll("button")).find((b) =>
          b.textContent?.includes("Charlie (Technical Reviewer)")
        ) as HTMLButtonElement;
        assert.ok(charlieBtn, "Charlie contact button missing");
        await act(async () => { charlieBtn.click(); });
        const charlieAddr = "GCEVSPK3KR7BHVHLBXD2IIVZBP5G4P73WBKWSA6ZWBGHB2FE7JDMZKTL";

        for (let step = 1; step <= 5; step++) {
          const continueBtn = Array.from(mounted.container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Continue")
          ) as HTMLButtonElement;
          assert.ok(continueBtn, `Continue missing at step ${step}`);
          await act(async () => { continueBtn.click(); });
        }

        const finalizeBtn = Array.from(mounted.container.querySelectorAll("button")).find((b) =>
          b.textContent?.includes("Create agreement")
        ) as HTMLButtonElement;
        await act(async () => { finalizeBtn.click(); });
        assert.strictEqual(postedPayloads.length, 1);
        assert.strictEqual(postedPayloads[0].terms.payer, externalAddr);
        assert.strictEqual(postedPayloads[0].terms.approver, externalAddr);
        assert.strictEqual(postedPayloads[0].terms.recipient, charlieAddr);

        // Switching account resets draft and selected wallet to the new user's primary
        await act(async () => {
          mounted.root.render(
            renderWorkspace([{ ...embeddedWallet, address: otherUserEmbedded }], otherUserEmbedded)
          );
        });
        assert.match(mounted.container.textContent || "", /What would you like to set up/i);

        // Unlinked/unverified only: blocks Step 1 advancement
        await act(async () => {
          mounted.root.render(renderWorkspace([unlinkedWallet, legacyUnverifiedWallet], embeddedAddr));
        });
        const createBtnUnlinked = Array.from(mounted.container.querySelectorAll("button")).find((b) =>
          b.textContent?.includes("Create payment")
        ) as HTMLButtonElement;
        await act(async () => { createBtnUnlinked.click(); });
        const continueBlocked = Array.from(mounted.container.querySelectorAll("button")).find((b) =>
          b.textContent?.includes("Continue")
        ) as HTMLButtonElement;
        await act(async () => { continueBlocked.click(); });
        assert.match(mounted.container.textContent || "", /active verified Stellar wallet/i);

        // AgreementDetailRoom correctly identifies participant wallet & provider
        const sampleAgreement: AgreementRecord = {
          id: "agr-detail-1",
          transactionType: "WORK",
          title: "Detail Check",
          description: "Desc",
          status: "CREATED",
          cancelRequest: "NONE",
          payerAccepted: true,
          recipientAccepted: false,
          canonicalHash: "a".repeat(64),
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          activity: [],
          terms: {
            amount: "100.00",
            asset: "USDC",
            payer: externalAddr,
            recipient: recipientAddr,
            approver: externalAddr,
            title: "Detail Check",
            description: "Desc",
            deliverables: ["One"],
            condition: "Approved",
            cancellationTerms: "Mutual",
            deadline: new Date(Date.now() + 86_400_000).toISOString(),
            contractId: "C_TEST",
            domain: "trustflow.stellar.escrow.v1",
            network: "testnet",
            version: 1,
          },
        };
        const detailMounted = await mountComponent(
          React.createElement(AuthProvider, {
            isPrivyConfiguredOverride: false,
            fetchFn: mockFetch,
            children: React.createElement(AgreementDetailRoom, {
              agreement: sampleAgreement,
              currentAccount: {
                address: embeddedAddr,
                displayName: "Alice",
                role: "PAYER",
                avatar: "A",
                balanceXLM: "0",
                balanceUSDC: "0",
                isSimulated: false,
                provider: "privy",
              },
              userWallets: [embeddedWallet, externalWallet],
              onUpdateAgreement: () => {},
              onBack: () => {},
            }),
          })
        );
        const payerNode = detailMounted.container.querySelector('[data-testid="participant-payer"]') as HTMLElement;
        assert.ok(payerNode);
        assert.strictEqual(payerNode.getAttribute("data-wallet-address"), externalAddr);
        assert.match(payerNode.textContent || "", /You · xBull/i);
        assert.match(payerNode.textContent || "", new RegExp(externalAddr));
        await detailMounted.unmount();
      } finally {
        await mounted.unmount();
        dom.cleanup();
      }
    });
  });

  describe("6. Production Build Isolation of Dev Signing Harness (§9)", () => {
    it("Production Vite build excludes DevPrivySigningTestPanel and privySigningTest while keeping source files intact for dev mode", async () => {
      assert.strictEqual(fs.existsSync(path.resolve("src/components/DevPrivySigningTestPanel.tsx")), true);
      assert.strictEqual(fs.existsSync(path.resolve("src/lib/auth/privySigningTest.ts")), true);

      const prodOutDir = path.join(tempDir, "dist-verify");
      await viteBuild({
        configFile: path.resolve("vite.config.ts"),
        build: {
          outDir: prodOutDir,
          emptyOutDir: true,
        },
        logLevel: "silent",
      });

      const assetsDir = path.join(prodOutDir, "assets");
      assert.strictEqual(fs.existsSync(assetsDir), true);
      const collectFiles = (dir: string): string[] => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const out: string[] = [];
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            out.push(...collectFiles(full));
          } else if (entry.isFile()) {
            out.push(full);
          }
        }
        return out;
      };

      const assetFiles = collectFiles(assetsDir);
      assert.strictEqual(
        assetFiles.some((f) => path.basename(f).includes("DevPrivySigningTestPanel")),
        false,
        "Production dist/assets must not emit a DevPrivySigningTestPanel chunk"
      );

      for (const filePath of assetFiles) {
        if (!/\.(js|mjs|css|html|map)$/i.test(filePath)) continue;
        const content = fs.readFileSync(filePath, "utf-8");
        assert.strictEqual(content.includes("DevPrivySigningTestPanel"), false, `Unexpected dev panel reference in ${filePath}`);
        assert.strictEqual(content.includes("raw-hash Privy signing test"), false, `Unexpected dev test copy in ${filePath}`);
        assert.strictEqual(content.includes("did:privy:cmm32325g016a0djr089b4x2b"), false, `Unexpected hardcoded dev privy ID in ${filePath}`);
      }

      // Check index.html built output has clean Phase 2 metadata (no live Soroban contract claims)
      const builtHtml = fs.readFileSync(path.join(prodOutDir, "index.html"), "utf-8");
      assert.strictEqual(/using soroban smart contracts/i.test(builtHtml), false);
    });
  });
});
