import { StrKey } from "@stellar/stellar-sdk";
import type { InteractiveAuthAdapter, ProviderAuthState } from "@pollar/core";
import {
  connectFreighterWallet,
  signFreighterSep53Challenge,
  type FreighterBridgeLike,
  type WalletAccount,
} from "../stellar/wallet";
import {
  connectStellarWalletProvider,
  signSep53MessageWithProvider,
  type StellarWalletAdapter,
  type StellarWalletProviderId,
} from "../stellar/walletsKit";

export type AuthLifecycleStage =
  | "initializing"
  | "unauthenticated"
  | "privy_authenticated"
  | "wallet_loading"
  | "wallet_ready"
  | "backend_syncing"
  | "authenticated"
  | "sync_failed";

export interface UserWalletRecord {
  id: string;
  address: string;
  custody: "none" | "privy_embedded" | "external_wallet" | "dev_sandbox";
  provider: string;
  privyWalletId?: string | null;
  verificationMethod: "privy_embedded" | "sep53" | "dev_sandbox" | "legacy_unverified";
  verifiedAt: string;
  linkedAt: string;
  unlinkedAt?: string | null;
  status: "active" | "unlinked";
  isPrimary: boolean;
}

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  displayName: string;
  avatar: string;
  provider: "email_otp" | "google" | "privy" | "dev_sandbox";
  authVerified: boolean;
  providerSubject?: string;
  stellarAddress: string | null;
  walletCustody: "none" | "privy_embedded" | "external_wallet" | "dev_sandbox";
  wallets?: UserWalletRecord[];
  primaryWalletAddress?: string | null;
  isSandbox: boolean;
  createdAt: string;
  lastLoginAt: string;
}

export interface AuthenticatedWallet {
  address: string | null;
  primaryWalletAddress?: string | null;
  network: "testnet";
  custody: AuthenticatedUser["walletCustody"];
  isEmbedded: boolean;
  wallets?: UserWalletRecord[];
  balanceXLM: string;
  balanceUSDC: string;
}

export interface AuthCapabilities {
  emailOtpConfigured: boolean;
  googleConfigured: boolean;
  privyConfigured: boolean;
  devSandboxEnabled: boolean;
  legacyAuthDisabled?: boolean;
}

export interface AuthSyncError {
  code: string;
  message: string;
  canRetrySync: boolean;
  requiresReauth: boolean;
  privySub: string | null;
}

export interface PrivyLinkedWalletLike {
  type?: string;
  address?: unknown;
  chainType?: unknown;
  chain_type?: unknown;
  walletClientType?: unknown;
  wallet_client_type?: unknown;
  walletClient?: unknown;
  wallet_client?: unknown;
  connectorType?: unknown;
  connector_type?: unknown;
}

export interface PrivyUserLike {
  id: string;
  linkedAccounts?: ReadonlyArray<PrivyLinkedWalletLike | Record<string, any>>;
}

export interface PrivyStateSnapshot {
  ready: boolean;
  authenticated: boolean;
  user: PrivyUserLike | null;
}

export interface AuthStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PrivyRuntimeActions {
  getAccessToken?: () => Promise<string | null>;
  refreshUser?: () => Promise<PrivyUserLike | null | undefined>;
  linkEmail?: () => void | Promise<void>;
  linkGoogle?: () => void | Promise<void>;
  logout?: () => Promise<void>;
  adapter?: Pick<
    InteractiveAuthAdapter,
    "sendEmailCode" | "verifyEmailCode" | "loginWithOAuth" | "disconnect" | "onProviderAuthChange"
  > | null;
}

export interface AuthControllerState {
  stage: AuthLifecycleStage;
  user: AuthenticatedUser | null;
  wallet: AuthenticatedWallet | null;
  capabilities: AuthCapabilities;
  isLoading: boolean;
  isAuthenticated: boolean;
  syncError: AuthSyncError | null;
  activePrivySub: string | null;
  retrievedPrivyWalletAddress: string | null;
  privyLinkingBusy: boolean;
  privyLinkingError: string | null;
  // TEMPORARY PHASE 2.2A TEST GUARD
  autoWalletProvisionDisabled: boolean;
}

export interface AuthControllerOptions {
  isPrivyConfigured: boolean;
  defaultDevSandboxEnabled?: boolean;
  fetchFn?: typeof fetch;
  storage?: AuthStorageLike | null;
  apiBaseUrl?: string;
  hydrationWaitMs?: number;
  hydrationPollMs?: number;
  // TEMPORARY PHASE 2.2A TEST GUARD: Disables automatic Stellar wallet creation in dev only
  disableAutoWalletProvision?: boolean;
  isProduction?: boolean;
}

export type EmbeddedWalletLookupResult =
  | { status: "found"; address: string }
  | { status: "missing"; sawExternalStellarWallet: boolean }
  | { status: "multiple"; addresses: string[] }
  | { status: "invalid"; reason: string };

export interface ExternalWalletChallengeResult {
  challengeId: string;
  address: string;
  provider: string;
  domain: string;
  network: string;
  expiresAt: string;
  message: string;
}

export const AUTH_TOKEN_STORAGE_KEY = "trustflow_auth_token";

const DEFAULT_HYDRATION_WAIT_MS = 300;
const DEFAULT_HYDRATION_POLL_MS = 25;

function isRuntimeProduction(explicitFlag?: boolean): boolean {
  if (explicitFlag !== undefined) return explicitFlag;
  const viteProd =
    typeof import.meta !== "undefined" &&
    Boolean((import.meta as { env?: { PROD?: boolean } }).env?.PROD);
  const nodeProd =
    typeof process !== "undefined" &&
    process.env?.NODE_ENV === "production";
  return viteProd || nodeProd;
}

export function isValidStellarPublicKey(address: unknown): address is string {
  if (typeof address !== "string") return false;
  const trimmed = address.trim();
  if (!trimmed.startsWith("G") || trimmed.length !== 56) {
    return false;
  }
  try {
    return StrKey.isValidEd25519PublicKey(trimmed);
  } catch {
    return false;
  }
}

function readChainType(account: PrivyLinkedWalletLike): unknown {
  return account.chainType ?? account.chain_type;
}

function readWalletClientType(account: PrivyLinkedWalletLike): unknown {
  return account.walletClientType ?? account.wallet_client_type;
}

function readWalletClient(account: PrivyLinkedWalletLike): unknown {
  return account.walletClient ?? account.wallet_client;
}

function readConnectorType(account: PrivyLinkedWalletLike): unknown {
  return account.connectorType ?? account.connector_type;
}

/**
 * Inspects a Privy user's linkedAccounts (camelCase SDK shape or snake_case API shape)
 * and extracts the single authoritative embedded Stellar wallet without picking
 * arbitrarily from multiple candidates or accepting external Stellar wallets.
 */
export function extractEmbeddedStellarWallet(
  privyUser: PrivyUserLike | null | undefined
): EmbeddedWalletLookupResult {
  if (!privyUser || !Array.isArray(privyUser.linkedAccounts)) {
    return { status: "missing", sawExternalStellarWallet: false };
  }

  const eligibleAddresses: string[] = [];
  let sawExternalStellarWallet = false;

  for (const rawAccount of privyUser.linkedAccounts) {
    const account = rawAccount as PrivyLinkedWalletLike;
    if (!account || account.type !== "wallet") {
      continue;
    }

    if (readChainType(account) !== "stellar") {
      continue;
    }

    const walletClientType = readWalletClientType(account);
    const walletClient = readWalletClient(account);
    const connectorType = readConnectorType(account);

    const claimsPrivyClient = walletClientType === "privy" || walletClient === "privy";
    const claimsEmbeddedConnector = connectorType === "embedded";

    // Skip strictly external Stellar wallets (e.g. Freighter / injected wallets)
    if (!claimsPrivyClient && !claimsEmbeddedConnector) {
      sawExternalStellarWallet = true;
      continue;
    }

    // Reject contradictory or incomplete embedded metadata
    const validClientType = walletClientType === "privy";
    const validWalletClient = walletClient === undefined || walletClient === "privy";
    const validConnector = connectorType === undefined || connectorType === "embedded";
    if (!validClientType || !validWalletClient || !validConnector) {
      return {
        status: "invalid",
        reason: "Embedded Stellar wallet metadata is inconsistent.",
      };
    }

    if (typeof account.address !== "string" || account.address.trim().length === 0) {
      return {
        status: "invalid",
        reason: "Embedded Stellar wallet is missing a valid address.",
      };
    }

    const address = account.address.trim();
    if (!isValidStellarPublicKey(address)) {
      return {
        status: "invalid",
        reason: "Embedded Stellar wallet address failed Stellar public key validation.",
      };
    }

    eligibleAddresses.push(address);
  }

  if (eligibleAddresses.length === 0) {
    return { status: "missing", sawExternalStellarWallet };
  }

  if (eligibleAddresses.length > 1) {
    return { status: "multiple", addresses: eligibleAddresses };
  }

  return { status: "found", address: eligibleAddresses[0] };
}

function createBrowserStorage(): AuthStorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createMemoryAuthStorage(): AuthStorageLike {
  const store = new Map<string, string>();
  return {
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
  };
}

function mapSyncFailure(
  statusCode: number | null,
  code: string | undefined,
  backendMessage: string | undefined,
  privySub: string | null
): AuthSyncError {
  if (statusCode === null) {
    return {
      code: "NETWORK_ERROR",
      message:
        "Could not reach the TrustFlow verification server. Check your connection and retry.",
      canRetrySync: true,
      requiresReauth: false,
      privySub,
    };
  }

  if (statusCode === 401) {
    return {
      code: code || "PRIVY_TOKEN_EXPIRED",
      message:
        "Your Privy authentication session expired or could not be verified. Please sign in again.",
      canRetrySync: true,
      requiresReauth: true,
      privySub,
    };
  }

  if (code === "NO_EMBEDDED_STELLAR_WALLET") {
    return {
      code,
      message:
        backendMessage ||
        "No verified embedded Stellar wallet was found on your Privy account yet. Retry once wallet setup finishes or sign out.",
      canRetrySync: true,
      requiresReauth: false,
      privySub,
    };
  }

  if (code === "MULTIPLE_EMBEDDED_STELLAR_WALLETS") {
    return {
      code,
      message:
        "Multiple embedded Stellar wallets are linked to this Privy account. Automatic selection is disabled for security.",
      canRetrySync: false,
      requiresReauth: false,
      privySub,
    };
  }

  if (code === "WALLET_OWNERSHIP_MISMATCH") {
    return {
      code,
      message:
        "The retrieved Stellar wallet does not match Privy's verified embedded wallet for this account.",
      canRetrySync: true,
      requiresReauth: false,
      privySub,
    };
  }

  if (code === "WALLET_ALREADY_LINKED" || code === "WALLET_IMMUTABLE") {
    return {
      code,
      message: backendMessage || "This Stellar wallet is already bound to another account.",
      canRetrySync: false,
      requiresReauth: false,
      privySub,
    };
  }

  if (statusCode >= 500) {
    return {
      code: code || "BACKEND_UNAVAILABLE",
      message:
        "TrustFlow's verification service is temporarily unavailable. Your sign-in is preserved—you can retry synchronization.",
      canRetrySync: true,
      requiresReauth: false,
      privySub,
    };
  }

  return {
    code: code || "SYNC_FAILED",
    message: backendMessage || "Failed to synchronize your account with TrustFlow.",
    canRetrySync: true,
    requiresReauth: false,
    privySub,
  };
}

function formatPrivyLinkingError(err: unknown): string | null {
  const raw =
    typeof err === "string"
      ? err
      : err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err || "");
  const normalized = raw.toLowerCase();

  if (
    normalized.includes("exited") ||
    normalized.includes("cancel") ||
    normalized.includes("closed") ||
    normalized.includes("aborted")
  ) {
    return "Linking was cancelled. Your existing TrustFlow account and wallet remain intact.";
  }

  if (
    normalized.includes("already") &&
    (normalized.includes("linked") || normalized.includes("exists") || normalized.includes("conflict"))
  ) {
    return "This email or Google identity is already linked to a different Privy account and cannot be merged.";
  }

  if (!raw.trim()) {
    return "Could not link that login method right now. Your existing account remains intact.";
  }

  return raw.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]");
}

export class TrustFlowAuthController {
  private readonly isPrivyConfigured: boolean;
  private readonly isProduction: boolean;
  private readonly fetchFn: typeof fetch;
  private readonly storage: AuthStorageLike | null;
  private readonly apiBaseUrl: string;
  private readonly hydrationWaitMs: number;
  private readonly hydrationPollMs: number;

  private listeners = new Set<(state: AuthControllerState) => void>();
  private hydrationWaiters = new Set<() => void>();

  private runtimeActions: PrivyRuntimeActions = {};
  private privySnapshot: PrivyStateSnapshot = {
    ready: false,
    authenticated: false,
    user: null,
  };

  private sessionRestoreDone = false;
  private sessionEpoch = 0;
  private syncEpoch = 0;
  private wasPrivyAuthenticated = false;
  private hasAttempted401Resync = false;

  private inFlightSync: {
    epoch: number;
    sub: string | null;
    promise: Promise<void>;
  } | null = null;

  private inFlight401Recovery: {
    epoch: number;
    tokenSnapshot: string | null;
    promise: Promise<boolean>;
  } | null = null;

  private recoveredTokenTransitions = new Map<string, string>();
  private resolvedWalletBySub = new Map<string, string>();

  // TEMPORARY PHASE 2.2A TEST GUARD
  private readonly autoWalletProvisionDisabled: boolean;

  private state: AuthControllerState;

  constructor(options: AuthControllerOptions) {
    this.isPrivyConfigured = options.isPrivyConfigured;
    this.isProduction = isRuntimeProduction(options.isProduction);
    this.fetchFn = options.fetchFn || globalThis.fetch.bind(globalThis);
    this.storage = options.storage !== undefined ? options.storage : createBrowserStorage();
    this.apiBaseUrl = (options.apiBaseUrl || "").replace(/\/+$/, "");
    this.hydrationWaitMs = options.hydrationWaitMs ?? DEFAULT_HYDRATION_WAIT_MS;
    this.hydrationPollMs = options.hydrationPollMs ?? DEFAULT_HYDRATION_POLL_MS;
    this.autoWalletProvisionDisabled =
      !this.isProduction && Boolean(options.disableAutoWalletProvision);

    this.state = {
      stage: "initializing",
      user: null,
      wallet: null,
      capabilities: {
        emailOtpConfigured: false,
        googleConfigured: false,
        privyConfigured: options.isPrivyConfigured,
        devSandboxEnabled: this.isProduction ? false : options.defaultDevSandboxEnabled ?? false,
        legacyAuthDisabled: this.isProduction,
      },
      isLoading: true,
      isAuthenticated: false,
      syncError: null,
      activePrivySub: null,
      retrievedPrivyWalletAddress: null,
      privyLinkingBusy: false,
      privyLinkingError: null,
      autoWalletProvisionDisabled: this.autoWalletProvisionDisabled,
    };
  }

  private apiUrl(path: string): string {
    return `${this.apiBaseUrl}${path}`;
  }

  public getState(): AuthControllerState {
    return this.state;
  }

  public subscribe(listener: (state: AuthControllerState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(patch: Partial<AuthControllerState>): void {
    const nextStage = patch.stage ?? this.state.stage;
    const nextUser = patch.user !== undefined ? patch.user : this.state.user;
    const isAuthenticated = nextStage === "authenticated" && Boolean(nextUser);
    const isLoading =
      nextStage === "initializing" ||
      nextStage === "privy_authenticated" ||
      nextStage === "wallet_loading" ||
      nextStage === "wallet_ready" ||
      nextStage === "backend_syncing";

    this.state = {
      ...this.state,
      ...patch,
      stage: nextStage,
      user: nextUser,
      isAuthenticated,
      isLoading,
    };

    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private notifyHydrationWaiters(): void {
    for (const wake of Array.from(this.hydrationWaiters)) {
      wake();
    }
  }

  private waitForHydrationTick(ms: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (done) return;
        done = true;
        this.hydrationWaiters.delete(finish);
        if (timer) clearTimeout(timer);
        resolve();
      };
      this.hydrationWaiters.add(finish);
      timer = setTimeout(finish, ms);
    });
  }

  public setRuntimeActions(actions: PrivyRuntimeActions): void {
    this.runtimeActions = actions;
  }

  public isAutoWalletProvisionDisabled(): boolean {
    return this.autoWalletProvisionDisabled;
  }

  public getAuthHeaders(): Record<string, string> {
    const token = this.storage?.getItem(AUTH_TOKEN_STORAGE_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  public updatePrivySnapshot(next: PrivyStateSnapshot): void {
    const prev = this.privySnapshot;
    const prevSub = prev.user?.id ?? null;
    const nextSub = next.user?.id ?? null;

    this.privySnapshot = next;

    // Detect explicit Privy subject change while holding stale state
    if (next.authenticated && nextSub && prevSub && nextSub !== prevSub) {
      this.resetForUserSwitch(nextSub);
    }

    this.notifyHydrationWaiters();
    this.reconcileAuthState();
  }

  public handleAdapterAuthSignal(providerState: ProviderAuthState): void {
    if (providerState.authenticated) {
      this.notifyHydrationWaiters();
    }
    this.reconcileAuthState();
  }

  private resetForUserSwitch(nextSub: string | null): void {
    this.syncEpoch += 1;
    this.sessionEpoch += 1;
    this.inFlightSync = null;
    this.inFlight401Recovery = null;
    this.hasAttempted401Resync = false;
    this.recoveredTokenTransitions.clear();
    this.resolvedWalletBySub.clear();
    this.storage?.removeItem(AUTH_TOKEN_STORAGE_KEY);
    this.setState({
      user: null,
      wallet: null,
      syncError: null,
      activePrivySub: nextSub,
      retrievedPrivyWalletAddress: null,
      privyLinkingBusy: false,
      privyLinkingError: null,
      stage: nextSub ? "privy_authenticated" : "unauthenticated",
    });
  }

  private invalidateStalePrivySession(tokenToRevoke?: string | null): void {
    this.syncEpoch += 1;
    this.sessionEpoch += 1;
    this.inFlightSync = null;
    this.inFlight401Recovery = null;
    this.wasPrivyAuthenticated = false;
    this.hasAttempted401Resync = false;
    this.recoveredTokenTransitions.clear();
    this.resolvedWalletBySub.clear();
    this.storage?.removeItem(AUTH_TOKEN_STORAGE_KEY);

    this.setState({
      user: null,
      wallet: null,
      syncError: null,
      activePrivySub: null,
      retrievedPrivyWalletAddress: null,
      privyLinkingBusy: false,
      privyLinkingError: null,
      stage: "unauthenticated",
    });

    if (tokenToRevoke) {
      void this.fetchFn(this.apiUrl("/api/auth/logout"), {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenToRevoke}` },
      }).catch(() => undefined);
    }
  }

  public async initSession(): Promise<void> {
    const startEpoch = this.sessionEpoch;
    try {
      const capRes = await this.fetchFn(this.apiUrl("/api/auth/capabilities"));
      if (capRes.ok && startEpoch === this.sessionEpoch) {
        const capData = (await capRes.json()) as AuthCapabilities;
        this.setState({ capabilities: capData });
      }
    } catch {
      // Capabilities check failure does not block session restore
    }

    const storedToken = this.storage?.getItem(AUTH_TOKEN_STORAGE_KEY);
    if (storedToken && startEpoch === this.sessionEpoch) {
      try {
        const res = await this.fetchFn(this.apiUrl("/api/auth/me"), {
          headers: { Authorization: `Bearer ${storedToken}` },
        });
        if (startEpoch !== this.sessionEpoch) {
          this.sessionRestoreDone = true;
          this.reconcileAuthState();
          return;
        }
        if (res.ok) {
          const data = (await res.json()) as {
            user: AuthenticatedUser | null;
            wallet: AuthenticatedWallet | null;
          };
          if (data.user) {
            const currentPrivySub = this.privySnapshot.user?.id ?? null;
            const privyConfirmsLoggedOut =
              this.isPrivyConfigured &&
              this.privySnapshot.ready &&
              !this.privySnapshot.authenticated &&
              data.user.provider === "privy";
            const privyMismatch =
              this.isPrivyConfigured &&
              this.privySnapshot.ready &&
              this.privySnapshot.authenticated &&
              data.user.provider === "privy" &&
              Boolean(currentPrivySub) &&
              data.user.providerSubject !== currentPrivySub;
            const invalidProdSandbox = this.isProduction && data.user.isSandbox;

            if (privyConfirmsLoggedOut || privyMismatch || invalidProdSandbox) {
              this.storage?.removeItem(AUTH_TOKEN_STORAGE_KEY);
              void this.fetchFn(this.apiUrl("/api/auth/logout"), {
                method: "POST",
                headers: { Authorization: `Bearer ${storedToken}` },
              }).catch(() => undefined);
            } else {
              this.hasAttempted401Resync = false;
              this.setState({
                user: data.user,
                wallet: data.wallet,
                stage: "authenticated",
                syncError: null,
              });
            }
          } else {
            this.storage?.removeItem(AUTH_TOKEN_STORAGE_KEY);
          }
        } else if (res.status === 401) {
          this.storage?.removeItem(AUTH_TOKEN_STORAGE_KEY);
        }
      } catch {
        // Network error during restore preserves existing token until connectivity/Privy settles
      }
    }

    this.sessionRestoreDone = true;
    this.reconcileAuthState();
  }

  private reconcileAuthState(): void {
    if (!this.sessionRestoreDone) {
      return;
    }

    if (!this.isPrivyConfigured) {
      if (this.state.user) {
        if (this.state.stage !== "authenticated") {
          this.setState({ stage: "authenticated", syncError: null });
        }
      } else if (this.state.stage === "initializing") {
        this.setState({ stage: "unauthenticated" });
      }
      return;
    }

    const privy = this.privySnapshot;

    // Wait for Privy SDK initialization before making any authenticated/unauthenticated decisions
    if (!privy.ready) {
      if (this.state.user && this.state.stage === "authenticated") {
        return;
      }
      if (this.state.stage !== "initializing" && !this.inFlightSync) {
        this.setState({ stage: "initializing" });
      }
      return;
    }

    if (!privy.authenticated) {
      // If Privy is ready and confirmed unauthenticated, NEVER keep a restored Privy TrustFlow session alive
      // across reload even if wasPrivyAuthenticated was false before this page load.
      if (this.state.user?.provider === "privy") {
        const staleToken = this.storage?.getItem(AUTH_TOKEN_STORAGE_KEY);
        this.invalidateStalePrivySession(staleToken);
        return;
      }

      if (this.wasPrivyAuthenticated) {
        this.wasPrivyAuthenticated = false;
        if (!this.state.user) {
          this.syncEpoch += 1;
          this.inFlightSync = null;
          this.resolvedWalletBySub.clear();
          this.setState({
            syncError: null,
            activePrivySub: null,
            retrievedPrivyWalletAddress: null,
            stage: "unauthenticated",
          });
        }
        return;
      }

      // Preserve legitimate non-Privy dev sandbox sessions even when Privy is unauthenticated
      if (this.state.user) {
        if (this.state.stage !== "authenticated") {
          this.setState({ stage: "authenticated", syncError: null });
        }
      } else if (!this.inFlightSync && this.state.stage !== "unauthenticated") {
        this.setState({
          stage: "unauthenticated",
          syncError: null,
          activePrivySub: null,
          retrievedPrivyWalletAddress: null,
        });
      }
      return;
    }

    // privy.ready && privy.authenticated
    this.wasPrivyAuthenticated = true;
    const privySub = privy.user?.id ?? null;

    // Clear stale non-Privy or mismatched-subject TrustFlow session immediately
    if (this.state.user) {
      const isDifferentProvider = this.state.user.provider !== "privy";
      const isDifferentPrivySubject =
        Boolean(privySub) &&
        Boolean(this.state.user.providerSubject) &&
        this.state.user.providerSubject !== privySub;

      if (isDifferentProvider || isDifferentPrivySubject) {
        this.resetForUserSwitch(privySub);
      } else if (privySub && this.state.user.providerSubject === privySub) {
        this.setState({
          stage: "authenticated",
          syncError: null,
          activePrivySub: privySub,
          retrievedPrivyWalletAddress: this.state.user.stellarAddress,
        });
        return;
      }
    }

    // Do not auto-loop when already failed for the exact same Privy user
    if (
      this.state.stage === "sync_failed" &&
      this.state.syncError?.privySub === privySub
    ) {
      return;
    }

    if (this.inFlightSync) {
      if (!privySub || this.inFlightSync.sub === null || this.inFlightSync.sub === privySub) {
        return;
      }
    }

    void this.syncPrivySession().catch(() => {
      // Recoverable failure state is already reflected on AuthControllerState.syncError
    });
  }

  private async waitForPrivyIdentity(
    epoch: number
  ): Promise<{ sub: string; clientWalletAddress: string | undefined }> {
    const deadline = Date.now() + this.hydrationWaitMs;
    let didCallRefreshUser = false;

    while (true) {
      if (epoch !== this.syncEpoch) {
        throw new Error("Authentication state changed.");
      }

      const snap = this.privySnapshot;
      if (!snap.ready || !snap.authenticated) {
        if (Date.now() >= deadline) {
          throw mapSyncFailure(
            401,
            "PRIVY_SESSION_UNAVAILABLE",
            "Privy authentication session is not active.",
            snap.user?.id ?? null
          );
        }
        await this.waitForHydrationTick(this.hydrationPollMs);
        continue;
      }

      const currentUser = snap.user;
      if (currentUser?.id) {
        const sub = currentUser.id;
        this.setState({ activePrivySub: sub });

        const cachedWallet = this.resolvedWalletBySub.get(sub);
        const lookup = extractEmbeddedStellarWallet(currentUser);

        if (lookup.status === "found") {
          this.resolvedWalletBySub.set(sub, lookup.address);
          return { sub, clientWalletAddress: lookup.address };
        }
        if (lookup.status === "multiple") {
          throw mapSyncFailure(409, "MULTIPLE_EMBEDDED_STELLAR_WALLETS", undefined, sub);
        }
        if (lookup.status === "invalid") {
          throw mapSyncFailure(400, "INVALID_PRIVY_WALLET", lookup.reason, sub);
        }
        if (cachedWallet && isValidStellarPublicKey(cachedWallet)) {
          return { sub, clientWalletAddress: cachedWallet };
        }

        // Wait briefly for SDK hydration or perform one refreshUser check before delegating to backend
        if (!didCallRefreshUser && this.runtimeActions.refreshUser) {
          didCallRefreshUser = true;
          try {
            const refreshed = await this.runtimeActions.refreshUser();
            if (epoch !== this.syncEpoch) {
              throw new Error("Authentication state changed.");
            }
            if (refreshed?.id === sub) {
              this.privySnapshot = { ...this.privySnapshot, user: refreshed };
              const refreshedLookup = extractEmbeddedStellarWallet(refreshed);
              if (refreshedLookup.status === "found") {
                this.resolvedWalletBySub.set(sub, refreshedLookup.address);
                return { sub, clientWalletAddress: refreshedLookup.address };
              }
              if (refreshedLookup.status === "multiple") {
                throw mapSyncFailure(409, "MULTIPLE_EMBEDDED_STELLAR_WALLETS", undefined, sub);
              }
              if (refreshedLookup.status === "invalid") {
                throw mapSyncFailure(400, "INVALID_PRIVY_WALLET", refreshedLookup.reason, sub);
              }
            }
          } catch (err) {
            if (isAuthSyncError(err)) throw err;
          }
        }

        if (Date.now() >= deadline || !this.runtimeActions.refreshUser) {
          // Dev-only Phase 2.2A guard: never auto-provision when test mode intentionally disables it
          if (this.autoWalletProvisionDisabled) {
            throw mapSyncFailure(
              403,
              "NO_EMBEDDED_STELLAR_WALLET",
              "Privy Wallet Test Mode is active: automatic Stellar wallet creation was skipped. Your Privy identity is authenticated with no embedded Stellar wallet.",
              sub
            );
          }
          // Under normal production/dev mode, backend coordinates provisioning idempotently
          return { sub, clientWalletAddress: undefined };
        }
      }

      if (Date.now() >= deadline) {
        throw mapSyncFailure(
          null,
          "PRIVY_USER_NOT_HYDRATED",
          "Privy user details did not finish loading in time. Please retry synchronization.",
          this.privySnapshot.user?.id ?? null
        );
      }
      await this.waitForHydrationTick(this.hydrationPollMs);
    }
  }

  private async executeBackendPrivySync(params: {
    accessToken: string;
    stellarAddress?: string;
    expectedSub: string | null;
    epoch: number;
    isRetry?: boolean;
  }): Promise<void> {
    const { accessToken, stellarAddress, expectedSub, epoch, isRetry = false } = params;
    const subForError = expectedSub ?? this.privySnapshot.user?.id ?? null;

    this.setState({ stage: "backend_syncing" });

    const payload: Record<string, unknown> = { accessToken };
    if (stellarAddress) {
      payload.stellarAddress = stellarAddress;
    }
    if (this.autoWalletProvisionDisabled) {
      payload.disableAutoProvision = true;
    }

    let res: Response;
    try {
      res = await this.fetchFn(this.apiUrl("/api/auth/privy-sync"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      throw mapSyncFailure(null, "NETWORK_ERROR", undefined, subForError);
    }

    if (epoch !== this.syncEpoch) return;

    let result: any = {};
    try {
      result = await res.json();
    } catch {
      result = {};
    }

    if (!res.ok) {
      throw mapSyncFailure(res.status, result.code, result.error, subForError);
    }

    // Verify user did not switch while backend request was in flight
    const postSub = this.privySnapshot.user?.id ?? null;
    const resolvedSub = result.user?.providerSubject ?? expectedSub ?? postSub;
    if (
      epoch !== this.syncEpoch ||
      (expectedSub && postSub && postSub !== expectedSub) ||
      (postSub && resolvedSub && resolvedSub !== postSub)
    ) {
      return;
    }

    const resolvedAddr: string | null = result.user?.stellarAddress || stellarAddress || null;
    if (resolvedSub && resolvedAddr && isValidStellarPublicKey(resolvedAddr)) {
      this.resolvedWalletBySub.set(resolvedSub, resolvedAddr);
    }

    // Normal (non-401-recovery) sync always unlocks future 401 recoveries cleanly;
    // 401-recovery unlocks hasAttempted401Resync only once the retried request succeeds.
    if (!isRetry) {
      this.hasAttempted401Resync = false;
      this.recoveredTokenTransitions.clear();
    }

    this.storage?.setItem(AUTH_TOKEN_STORAGE_KEY, result.token);
    this.setState({
      stage: "authenticated",
      user: result.user,
      wallet: result.wallet,
      syncError: null,
      activePrivySub: resolvedSub ?? null,
      retrievedPrivyWalletAddress: resolvedAddr,
    });

    // Best-effort client SDK refresh so embedded signing discovers newly server-provisioned wallets.
    if (this.runtimeActions.refreshUser && !isRetry && resolvedSub) {
      void Promise.resolve(this.runtimeActions.refreshUser())
        .then((refreshed) => {
          if (epoch === this.syncEpoch && refreshed?.id === resolvedSub) {
            this.privySnapshot = { ...this.privySnapshot, user: refreshed ?? null };
          }
        })
        .catch(() => undefined);
    }
  }

  public syncPrivySession(options: {
    allowWalletProvision?: boolean;
    isRetry?: boolean;
  } = {}): Promise<void> {
    const currentSub = this.privySnapshot.user?.id ?? null;

    if (this.inFlightSync) {
      if (
        this.inFlightSync.epoch === this.syncEpoch &&
        (this.inFlightSync.sub === null ||
          currentSub === null ||
          this.inFlightSync.sub === currentSub)
      ) {
        return this.inFlightSync.promise;
      }
    }

    if (
      !options.isRetry &&
      this.state.stage === "authenticated" &&
      this.state.user?.provider === "privy" &&
      currentSub &&
      this.state.user.providerSubject === currentSub
    ) {
      return Promise.resolve();
    }

    const epoch = this.syncEpoch;
    const isRetry = options.isRetry ?? false;

    const entry: { epoch: number; sub: string | null; promise: Promise<void> } = {
      epoch,
      sub: currentSub,
      promise: Promise.resolve(),
    };

    const promise = (async () => {
      try {
        this.setState({
          stage: "wallet_loading",
          syncError: null,
          activePrivySub: currentSub,
        });

        const { sub, clientWalletAddress } = await this.waitForPrivyIdentity(epoch);

        if (epoch !== this.syncEpoch) return;

        const latestSub = this.privySnapshot.user?.id ?? sub;
        if (latestSub !== sub) {
          throw new Error("Privy user changed during synchronization.");
        }

        if (this.inFlightSync === entry) {
          this.inFlightSync.sub = sub;
        }

        if (clientWalletAddress) {
          this.setState({
            stage: "wallet_ready",
            activePrivySub: sub,
            retrievedPrivyWalletAddress: clientWalletAddress,
          });
        }

        const accessToken = this.runtimeActions.getAccessToken
          ? await this.runtimeActions.getAccessToken()
          : null;

        if (epoch !== this.syncEpoch) return;

        if (!accessToken) {
          throw mapSyncFailure(
            401,
            "PRIVY_TOKEN_MISSING",
            "Privy access token could not be retrieved. Please sign in again.",
            sub
          );
        }

        await this.executeBackendPrivySync({
          accessToken,
          stellarAddress: clientWalletAddress,
          expectedSub: sub,
          epoch,
          isRetry,
        });
      } catch (err) {
        if (epoch !== this.syncEpoch) {
          return;
        }
        const syncErr: AuthSyncError = isAuthSyncError(err)
          ? err
          : mapSyncFailure(
              null,
              "SYNC_FAILED",
              err instanceof Error ? err.message : "Failed to synchronize Privy session.",
              this.privySnapshot.user?.id ?? currentSub
            );

        this.setState({
          stage: "sync_failed",
          user: null,
          wallet: null,
          syncError: syncErr,
        });
        throw new Error(syncErr.message);
      } finally {
        if (this.inFlightSync === entry) {
          this.inFlightSync = null;
        }
      }
    })();

    entry.promise = promise;
    this.inFlightSync = entry;
    return promise;
  }

  public async retryPrivySync(): Promise<void> {
    await this.syncPrivySession({
      isRetry: true,
    });
  }

  public async syncPrivyUserDirect(data: {
    accessToken: string;
    stellarAddress?: string;
  }): Promise<void> {
    const currentSub = this.privySnapshot.user?.id ?? null;

    if (
      this.inFlightSync &&
      this.inFlightSync.epoch === this.syncEpoch &&
      (this.inFlightSync.sub === null ||
        currentSub === null ||
        this.inFlightSync.sub === currentSub)
    ) {
      await this.inFlightSync.promise;
      return;
    }

    const epoch = this.syncEpoch;
    const expectedSub = currentSub;

    const entry: { epoch: number; sub: string | null; promise: Promise<void> } = {
      epoch,
      sub: expectedSub,
      promise: Promise.resolve(),
    };

    const promise = (async () => {
      try {
        await this.executeBackendPrivySync({
          accessToken: data.accessToken,
          stellarAddress: data.stellarAddress,
          expectedSub,
          epoch,
          isRetry: false,
        });
      } catch (err) {
        if (epoch !== this.syncEpoch) {
          return;
        }
        const syncErr: AuthSyncError = isAuthSyncError(err)
          ? err
          : mapSyncFailure(
              null,
              "SYNC_FAILED",
              err instanceof Error ? err.message : "Failed to verify Privy authentication.",
              this.privySnapshot.user?.id ?? expectedSub
            );

        this.setState({
          stage: "sync_failed",
          user: null,
          wallet: null,
          syncError: syncErr,
        });
        throw new Error(syncErr.message);
      }
    })();

    entry.promise = promise;
    this.inFlightSync = entry;
    try {
      await promise;
    } finally {
      if (this.inFlightSync === entry) {
        this.inFlightSync = null;
      }
      if (
        this.privySnapshot.ready &&
        this.privySnapshot.authenticated &&
        this.state.stage !== "sync_failed" &&
        (!this.state.isAuthenticated ||
          (this.privySnapshot.user?.id &&
            this.state.user?.providerSubject !== this.privySnapshot.user.id))
      ) {
        this.reconcileAuthState();
      }
    }
  }

  private clearAuthOn401(expectedSessionEpoch: number): void {
    if (expectedSessionEpoch !== this.sessionEpoch) {
      return;
    }
    this.hasAttempted401Resync = false;
    this.inFlight401Recovery = null;
    this.recoveredTokenTransitions.clear();
    this.storage?.removeItem(AUTH_TOKEN_STORAGE_KEY);
    this.setState({
      stage: "unauthenticated",
      user: null,
      wallet: null,
      syncError: null,
      activePrivySub: null,
      retrievedPrivyWalletAddress: null,
    });
  }

  private async runCoalesced401Recovery(
    expectedSessionEpoch: number,
    tokenSnapshot: string | null
  ): Promise<boolean> {
    if (expectedSessionEpoch !== this.sessionEpoch) {
      return false;
    }

    if (
      this.inFlight401Recovery &&
      this.inFlight401Recovery.epoch === expectedSessionEpoch &&
      this.inFlight401Recovery.tokenSnapshot === tokenSnapshot
    ) {
      return this.inFlight401Recovery.promise;
    }

    const canResyncViaPrivy =
      this.isPrivyConfigured &&
      this.privySnapshot.ready &&
      this.privySnapshot.authenticated &&
      this.state.user?.provider === "privy" &&
      !this.hasAttempted401Resync;

    if (!canResyncViaPrivy) {
      return false;
    }

    this.hasAttempted401Resync = true;

    const entry = {
      epoch: expectedSessionEpoch,
      tokenSnapshot,
      promise: (async () => {
        try {
          if (tokenSnapshot) {
            this.storage?.removeItem(AUTH_TOKEN_STORAGE_KEY);
          }
          await this.syncPrivySession({ isRetry: true });
          if (expectedSessionEpoch !== this.sessionEpoch) {
            return false;
          }
          const freshToken = this.storage?.getItem(AUTH_TOKEN_STORAGE_KEY) ?? null;
          if (!freshToken || freshToken === tokenSnapshot) {
            return false;
          }
          if (tokenSnapshot) {
            this.recoveredTokenTransitions.set(tokenSnapshot, freshToken);
          }
          return true;
        } catch {
          return false;
        }
      })(),
    };

    this.inFlight401Recovery = entry;
    try {
      return await entry.promise;
    } finally {
      if (this.inFlight401Recovery === entry) {
        this.inFlight401Recovery = null;
      }
    }
  }

  /**
   * Shared authenticated fetch helper:
   * - Attaches current TrustFlow Bearer token.
   * - Handles genuine 401 session rejections consistently without logging out on 403/5xx/network errors.
   * - Coalesces concurrent 401 recoveries onto a single guarded Privy re-sync, permits future
   *   independent 401 recovery cycles once a retry succeeds, and prevents infinite retry loops.
   */
  public async authenticatedFetch(
    input: RequestInfo | URL,
    init: RequestInit = {}
  ): Promise<Response> {
    const startSessionEpoch = this.sessionEpoch;
    const tokenSnapshot = this.storage?.getItem(AUTH_TOKEN_STORAGE_KEY) ?? null;
    const headers = new Headers(init.headers || {});
    if (tokenSnapshot && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${tokenSnapshot}`);
    }

    const res = await this.fetchFn(input, { ...init, headers });
    if (res.status !== 401) {
      if (startSessionEpoch === this.sessionEpoch && tokenSnapshot) {
        this.hasAttempted401Resync = false;
      }
      return res;
    }

    // Ignore stale 401 responses belonging to a switched/logged-out account
    if (startSessionEpoch !== this.sessionEpoch) {
      return res;
    }

    const currentToken = this.storage?.getItem(AUTH_TOKEN_STORAGE_KEY) ?? null;

    // If another concurrent request already upgraded tokenSnapshot -> currentToken in this same epoch,
    // retry once directly using currentToken without issuing a duplicate privy-sync.
    const transitionedToken =
      tokenSnapshot && this.recoveredTokenTransitions.get(tokenSnapshot);
    if (transitionedToken && currentToken === transitionedToken) {
      const retryHeaders = new Headers(init.headers || {});
      retryHeaders.set("Authorization", `Bearer ${currentToken}`);
      const retryRes = await this.fetchFn(input, { ...init, headers: retryHeaders });
      if (startSessionEpoch !== this.sessionEpoch) {
        return retryRes;
      }
      if (retryRes.status !== 401) {
        this.hasAttempted401Resync = false;
        return retryRes;
      }
      this.clearAuthOn401(startSessionEpoch);
      return retryRes;
    }

    // Otherwise if token was changed externally without transition map, treat original 401 as stale
    if (tokenSnapshot !== currentToken && !this.inFlight401Recovery) {
      return res;
    }

    const recovered = await this.runCoalesced401Recovery(startSessionEpoch, tokenSnapshot);
    if (startSessionEpoch !== this.sessionEpoch) {
      return res;
    }

    if (recovered) {
      const freshToken = this.storage?.getItem(AUTH_TOKEN_STORAGE_KEY) ?? null;
      if (freshToken && freshToken !== tokenSnapshot) {
        const retryHeaders = new Headers(init.headers || {});
        retryHeaders.set("Authorization", `Bearer ${freshToken}`);
        const retryRes = await this.fetchFn(input, { ...init, headers: retryHeaders });
        if (startSessionEpoch !== this.sessionEpoch) {
          return retryRes;
        }
        if (retryRes.status === 401) {
          // Recovery retry still returned 401 — terminate cleanly with no further retries
          this.clearAuthOn401(startSessionEpoch);
          return retryRes;
        }
        // Retry succeeded — permit future independent 401 recovery cycles later in the session
        this.hasAttempted401Resync = false;
        return retryRes;
      }
    }

    // If syncPrivySession entered recoverable sync_failed, preserve sync_failed UI rather than wiping syncError
    if (this.state.stage === "sync_failed") {
      return res;
    }

    this.clearAuthOn401(startSessionEpoch);
    return res;
  }

  public async sendOtpCode(email: string): Promise<{ success: boolean; message: string }> {
    if (this.isPrivyConfigured && this.runtimeActions.adapter) {
      await this.runtimeActions.adapter.sendEmailCode(email);
      return { success: true, message: `Verification code sent via Privy to ${email}.` };
    }
    if (this.isProduction || this.state.capabilities.legacyAuthDisabled) {
      throw new Error("Privy authentication is required in production and is not currently configured.");
    }
    const res = await this.fetchFn(this.apiUrl("/api/auth/otp/start"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) {
      throw new Error(data.error || "Failed to send verification code.");
    }
    return data;
  }

  public async verifyOtpCode(email: string, code: string): Promise<void> {
    if (this.isPrivyConfigured && this.runtimeActions.adapter) {
      await this.runtimeActions.adapter.verifyEmailCode(code);
      this.wasPrivyAuthenticated = true;
      await this.syncPrivySession();
      return;
    }

    if (this.isProduction || this.state.capabilities.legacyAuthDisabled) {
      throw new Error("Privy authentication is required in production and is not currently configured.");
    }

    const res = await this.fetchFn(this.apiUrl("/api/auth/otp/verify"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) {
      throw new Error(data.error || "Failed to verify code.");
    }

    this.hasAttempted401Resync = false;
    this.storage?.setItem(AUTH_TOKEN_STORAGE_KEY, data.token);
    this.setState({
      stage: "authenticated",
      user: data.user,
      wallet: data.wallet,
      syncError: null,
    });
  }

  public async loginWithGoogle(idToken?: string): Promise<void> {
    if (this.isPrivyConfigured && this.runtimeActions.adapter) {
      await this.runtimeActions.adapter.loginWithOAuth("google");
      this.wasPrivyAuthenticated = true;
      await this.syncPrivySession();
      return;
    }

    if (this.isProduction || this.state.capabilities.legacyAuthDisabled) {
      throw new Error("Privy authentication is required in production and is not currently configured.");
    }

    if (!idToken) {
      throw new Error(
        this.state.capabilities.googleConfigured
          ? "Google sign-in requires a verified Google ID token."
          : "Google Sign-In is not configured on this server. Use Email Sign-In or Test Sandbox Mode in development."
      );
    }

    const res = await this.fetchFn(this.apiUrl("/api/auth/google"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) {
      throw new Error(data.error || "Google verification failed.");
    }

    this.hasAttempted401Resync = false;
    this.storage?.setItem(AUTH_TOKEN_STORAGE_KEY, data.token);
    this.setState({
      stage: "authenticated",
      user: data.user,
      wallet: data.wallet,
      syncError: null,
    });
  }

  public async enterSandbox(personaKey: "alice" | "bob" | "charlie" = "alice"): Promise<void> {
    const res = await this.fetchFn(this.apiUrl("/api/auth/sandbox"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona: personaKey }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) {
      throw new Error(data.error || "Development sandbox is unavailable.");
    }

    this.hasAttempted401Resync = false;
    this.storage?.setItem(AUTH_TOKEN_STORAGE_KEY, data.token);
    this.setState({
      stage: "authenticated",
      user: data.user,
      wallet: data.wallet,
      syncError: null,
    });
  }

  public async linkExternalWallet(_stellarAddress: string): Promise<never> {
    throw new Error(
      "Direct address-only wallet linking is retired. Connect an external Stellar wallet and sign the SEP-53 challenge."
    );
  }

  public async requestExternalWalletChallenge(
    address: string,
    provider: string
  ): Promise<ExternalWalletChallengeResult> {
    if (!this.state.isAuthenticated || !this.state.user) {
      throw new Error("Sign in before linking an external wallet.");
    }
    if (this.state.user.isSandbox) {
      throw new Error("Development sandbox personas have fixed test addresses.");
    }

    const challengeRes = await this.authenticatedFetch(
      this.apiUrl("/api/auth/wallets/external/challenge"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, provider }),
      }
    );
    const challengeBody = (await challengeRes.json().catch(() => ({}))) as any;
    if (!challengeRes.ok) {
      throw new Error(
        challengeBody.error || "Failed to create external wallet verification challenge."
      );
    }

    return challengeBody as ExternalWalletChallengeResult;
  }

  public async completeExternalWalletVerification(params: {
    challengeId: string;
    address: string;
    signature: string;
  }): Promise<UserWalletRecord> {
    if (!this.state.isAuthenticated || !this.state.user) {
      throw new Error("Sign in before linking an external wallet.");
    }

    const verifyRes = await this.authenticatedFetch(
      this.apiUrl("/api/auth/wallets/external/verify"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      }
    );
    const verifyBody = (await verifyRes.json().catch(() => ({}))) as any;
    if (!verifyRes.ok) {
      throw new Error(verifyBody.error || "Failed to verify external wallet ownership.");
    }

    this.setState({
      user: verifyBody.user,
      wallet: verifyBody.wallet,
    });

    return verifyBody.linkedWallet as UserWalletRecord;
  }

  public async linkExternalWalletWithProvider(
    providerId: StellarWalletProviderId,
    adapter?: StellarWalletAdapter
  ): Promise<UserWalletRecord> {
    if (!this.state.isAuthenticated || !this.state.user) {
      throw new Error("Sign in before linking an external wallet.");
    }
    if (this.state.user.isSandbox) {
      throw new Error("Development sandbox personas have fixed test addresses.");
    }

    const connected = await connectStellarWalletProvider(providerId, adapter);
    const challenge = await this.requestExternalWalletChallenge(
      connected.address,
      connected.providerId
    );
    const { signature } = await signSep53MessageWithProvider(
      connected.providerId,
      {
        address: challenge.address,
        message: challenge.message,
      },
      adapter
    );

    return this.completeExternalWalletVerification({
      challengeId: challenge.challengeId,
      address: challenge.address,
      signature,
    });
  }

  public async linkExternalWalletWithFreighter(
    bridge?: FreighterBridgeLike
  ): Promise<UserWalletRecord> {
    if (!this.state.isAuthenticated || !this.state.user) {
      throw new Error("Sign in before linking an external wallet.");
    }
    if (this.state.user.isSandbox) {
      throw new Error("Development sandbox personas have fixed test addresses.");
    }

    const account = await connectFreighterWallet(bridge);
    const challenge = await this.requestExternalWalletChallenge(account.address, "freighter");

    const { signature } = await signFreighterSep53Challenge({
      address: challenge.address || account.address,
      message: challenge.message,
      bridge,
    });

    return this.completeExternalWalletVerification({
      challengeId: challenge.challengeId,
      address: challenge.address || account.address,
      signature,
    });
  }

  public async unlinkExternalWallet(walletId: string): Promise<void> {
    if (!this.state.isAuthenticated || !this.state.user) {
      throw new Error("Sign in before modifying linked wallets.");
    }

    const res = await this.authenticatedFetch(
      this.apiUrl(`/api/auth/wallets/${encodeURIComponent(walletId)}`),
      { method: "DELETE" }
    );
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      throw new Error(data.error || "Failed to unlink external wallet.");
    }

    this.setState({
      user: data.user,
      wallet: data.wallet,
    });
  }

  public async startPrivyEmailLink(): Promise<void> {
    if (!this.isPrivyConfigured || this.state.user?.provider !== "privy") {
      throw new Error("Privy authentication is required before linking another login method.");
    }
    if (!this.runtimeActions.linkEmail) {
      throw new Error("Privy email linking is not available in the current client session.");
    }
    this.setState({ privyLinkingBusy: true, privyLinkingError: null });
    try {
      await Promise.resolve(this.runtimeActions.linkEmail());
    } catch (err) {
      this.handlePrivyLinkError(err);
    }
  }

  public async startPrivyGoogleLink(): Promise<void> {
    if (!this.isPrivyConfigured || this.state.user?.provider !== "privy") {
      throw new Error("Privy authentication is required before linking another login method.");
    }
    if (!this.runtimeActions.linkGoogle) {
      throw new Error("Privy Google linking is not available in the current client session.");
    }
    this.setState({ privyLinkingBusy: true, privyLinkingError: null });
    try {
      await Promise.resolve(this.runtimeActions.linkGoogle());
    } catch (err) {
      this.handlePrivyLinkError(err);
    }
  }

  public async handlePrivyLinkSuccess(updatedPrivyUser?: PrivyUserLike | null): Promise<void> {
    const activeSub = this.state.user?.providerSubject || this.privySnapshot.user?.id || null;
    if (!activeSub) {
      this.setState({ privyLinkingBusy: false });
      return;
    }

    if (updatedPrivyUser?.id && updatedPrivyUser.id !== activeSub) {
      this.setState({
        privyLinkingBusy: false,
        privyLinkingError:
          "Linked identity returned a different Privy subject and was rejected to protect your account.",
      });
      return;
    }

    if (updatedPrivyUser?.id === activeSub) {
      this.privySnapshot = { ...this.privySnapshot, user: updatedPrivyUser };
    } else if (this.runtimeActions.refreshUser) {
      try {
        const refreshed = await this.runtimeActions.refreshUser();
        if (refreshed?.id === activeSub) {
          this.privySnapshot = { ...this.privySnapshot, user: refreshed };
        }
      } catch {
        // Proceed with backend sync using existing token
      }
    }

    try {
      await this.syncPrivySession({ isRetry: true });
      this.setState({ privyLinkingBusy: false, privyLinkingError: null });
    } catch (err) {
      this.setState({
        privyLinkingBusy: false,
        privyLinkingError:
          err instanceof Error
            ? err.message
            : "Account linked in Privy, but profile synchronization could not complete.",
      });
    }
  }

  public handlePrivyLinkError(error: unknown): void {
    this.setState({
      privyLinkingBusy: false,
      privyLinkingError: formatPrivyLinkingError(error),
    });
  }

  public handlePrivyLinkCancelled(): void {
    if (!this.state.privyLinkingBusy) return;
    this.setState({
      privyLinkingBusy: false,
      privyLinkingError:
        "Linking was cancelled. Your existing TrustFlow account and wallet remain intact.",
    });
  }

  public clearPrivyLinkError(): void {
    this.setState({ privyLinkingError: null });
  }

  public async refreshBalance(): Promise<void> {
    const storedToken = this.storage?.getItem(AUTH_TOKEN_STORAGE_KEY);
    if (!storedToken) return;
    const expectedUserId = this.state.user?.id ?? null;
    const res = await this.authenticatedFetch(this.apiUrl("/api/auth/me"));
    if (res.ok) {
      const data = (await res.json()) as {
        user?: AuthenticatedUser | null;
        wallet?: AuthenticatedWallet | null;
      };
      if (data.wallet && (!expectedUserId || this.state.user?.id === expectedUserId)) {
        this.setState({
          wallet: data.wallet,
          ...(data.user ? { user: data.user } : {}),
        });
      }
    }
  }

  public async logout(): Promise<void> {
    this.syncEpoch += 1;
    this.sessionEpoch += 1;
    this.inFlightSync = null;
    this.inFlight401Recovery = null;
    this.wasPrivyAuthenticated = false;
    this.hasAttempted401Resync = false;
    this.recoveredTokenTransitions.clear();
    this.resolvedWalletBySub.clear();

    const storedToken = this.storage?.getItem(AUTH_TOKEN_STORAGE_KEY);
    this.storage?.removeItem(AUTH_TOKEN_STORAGE_KEY);

    this.setState({
      stage: "unauthenticated",
      user: null,
      wallet: null,
      syncError: null,
      activePrivySub: null,
      retrievedPrivyWalletAddress: null,
      privyLinkingBusy: false,
      privyLinkingError: null,
    });

    if (this.isPrivyConfigured) {
      try {
        if (this.runtimeActions.logout) {
          await this.runtimeActions.logout();
        } else if (this.runtimeActions.adapter) {
          await this.runtimeActions.adapter.disconnect();
        }
      } catch (err) {
        console.warn("[TrustFlow Auth] Privy disconnect notice:", err);
      }
    }

    if (storedToken) {
      try {
        await this.fetchFn(this.apiUrl("/api/auth/logout"), {
          method: "POST",
          headers: { Authorization: `Bearer ${storedToken}` },
        });
      } catch (err) {
        console.warn("[TrustFlow Auth] Logout notice:", err);
      }
    }
  }

  public static buildEffectiveAccount(
    user: AuthenticatedUser | null,
    wallet: AuthenticatedWallet | null,
    simulatedProfiles: WalletAccount[]
  ): WalletAccount | null {
    if (!user) return null;
    if (user.isSandbox) {
      const matched =
        simulatedProfiles.find((p) => p.address === user.stellarAddress) || simulatedProfiles[0];
      return {
        ...matched,
        id: user.id,
        email: user.email || undefined,
        balanceXLM: wallet?.balanceXLM || "0.00",
        balanceUSDC: wallet?.balanceUSDC || "0.00",
        isSimulated: true,
        provider: "simulated",
      };
    }

    return {
      id: user.id,
      email: user.email || undefined,
      address: user.primaryWalletAddress || user.stellarAddress || "",
      displayName: user.displayName,
      role: "PAYER",
      avatar: user.avatar,
      balanceXLM: wallet?.balanceXLM || "0.00",
      balanceUSDC: wallet?.balanceUSDC || "0.00",
      isSimulated: false,
      isEmbedded: user.walletCustody === "privy_embedded",
      provider: user.provider === "dev_sandbox" ? "simulated" : user.provider,
    };
  }
}

function isAuthSyncError(value: unknown): value is AuthSyncError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    "canRetrySync" in value &&
    "requiresReauth" in value
  );
}
