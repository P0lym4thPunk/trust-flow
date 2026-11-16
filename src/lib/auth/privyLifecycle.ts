import { StrKey } from "@stellar/stellar-sdk";
import type { InteractiveAuthAdapter, ProviderAuthState } from "@pollar/core";
import type { WalletAccount } from "../stellar/wallet";

export type AuthLifecycleStage =
  | "initializing"
  | "unauthenticated"
  | "privy_authenticated"
  | "wallet_loading"
  | "wallet_ready"
  | "backend_syncing"
  | "authenticated"
  | "sync_failed";

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
  isSandbox: boolean;
  createdAt: string;
  lastLoginAt: string;
}

export interface AuthenticatedWallet {
  address: string | null;
  network: "testnet";
  custody: AuthenticatedUser["walletCustody"];
  isEmbedded: boolean;
  balanceXLM: string;
  balanceUSDC: string;
}

export interface AuthCapabilities {
  emailOtpConfigured: boolean;
  googleConfigured: boolean;
  privyConfigured: boolean;
  devSandboxEnabled: boolean;
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
  createWallet?: (input: { chainType: "stellar" }) => Promise<{
    user?: PrivyUserLike | null;
    wallet?: PrivyLinkedWalletLike | null;
  }>;
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
  // TEMPORARY PHASE 2.2A TEST GUARD: Disables automatic client-side Stellar wallet creation in dev only
  disableAutoWalletProvision?: boolean;
  isProduction?: boolean;
}

export type EmbeddedWalletLookupResult =
  | { status: "found"; address: string }
  | { status: "missing"; sawExternalStellarWallet: boolean }
  | { status: "multiple"; addresses: string[] }
  | { status: "invalid"; reason: string };

export const AUTH_TOKEN_STORAGE_KEY = "trustflow_auth_token";

const DEFAULT_HYDRATION_WAIT_MS = 1200;
const DEFAULT_HYDRATION_POLL_MS = 40;

// TEMPORARY PHASE 2.2A TEST GUARD: Ensures test-mode wallet-provision disablement cannot run in production
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

function validateCreatedWalletRecord(
  wallet: PrivyLinkedWalletLike | null | undefined
): string | null {
  if (!wallet) return null;
  const chainType = readChainType(wallet);
  if (chainType !== undefined && chainType !== "stellar") {
    return null;
  }
  const walletClientType = readWalletClientType(wallet);
  if (walletClientType !== undefined && walletClientType !== "privy") {
    return null;
  }
  const connectorType = readConnectorType(wallet);
  if (connectorType !== undefined && connectorType !== "embedded") {
    return null;
  }
  if (typeof wallet.address !== "string") return null;
  const address = wallet.address.trim();
  return isValidStellarPublicKey(address) ? address : null;
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

export class TrustFlowAuthController {
  private readonly isPrivyConfigured: boolean;
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

  private inFlightSync: {
    epoch: number;
    sub: string | null;
    promise: Promise<void>;
  } | null = null;

  private resolvedWalletBySub = new Map<string, string>();
  private walletProvisionAttemptedSubs = new Set<string>();
  private inFlightWalletProvisionBySub = new Map<string, Promise<string | null>>();

  // TEMPORARY PHASE 2.2A TEST GUARD
  private readonly autoWalletProvisionDisabled: boolean;

  private state: AuthControllerState;

  constructor(options: AuthControllerOptions) {
    this.isPrivyConfigured = options.isPrivyConfigured;
    this.fetchFn = options.fetchFn || globalThis.fetch.bind(globalThis);
    this.storage = options.storage !== undefined ? options.storage : createBrowserStorage();
    this.apiBaseUrl = (options.apiBaseUrl || "").replace(/\/+$/, "");
    this.hydrationWaitMs = options.hydrationWaitMs ?? DEFAULT_HYDRATION_WAIT_MS;
    this.hydrationPollMs = options.hydrationPollMs ?? DEFAULT_HYDRATION_POLL_MS;
    this.autoWalletProvisionDisabled =
      !isRuntimeProduction(options.isProduction) && Boolean(options.disableAutoWalletProvision);

    this.state = {
      stage: "initializing",
      user: null,
      wallet: null,
      capabilities: {
        emailOtpConfigured: false,
        googleConfigured: false,
        privyConfigured: options.isPrivyConfigured,
        devSandboxEnabled: options.defaultDevSandboxEnabled ?? false,
      },
      isLoading: true,
      isAuthenticated: false,
      syncError: null,
      activePrivySub: null,
      retrievedPrivyWalletAddress: null,
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
    // TEMPORARY PHASE 2.2A TEST GUARD: Never retain createWallet when test guard is active
    this.runtimeActions = this.autoWalletProvisionDisabled
      ? { ...actions, createWallet: undefined }
      : actions;
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
    // Only wake hydration waiters; authoritative user metadata & readiness come from Privy snapshot
    if (providerState.authenticated) {
      this.notifyHydrationWaiters();
    }
    this.reconcileAuthState();
  }

  private resetForUserSwitch(nextSub: string | null): void {
    this.syncEpoch += 1;
    this.sessionEpoch += 1;
    this.inFlightSync = null;
    this.resolvedWalletBySub.clear();
    this.walletProvisionAttemptedSubs.clear();
    this.inFlightWalletProvisionBySub.clear();
    this.storage?.removeItem(AUTH_TOKEN_STORAGE_KEY);
    this.setState({
      user: null,
      wallet: null,
      syncError: null,
      activePrivySub: nextSub,
      retrievedPrivyWalletAddress: null,
      stage: nextSub ? "privy_authenticated" : "unauthenticated",
    });
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
            // If Privy is already ready and reports a DIFFERENT user, never adopt stale User A session
            const currentPrivySub = this.privySnapshot.user?.id ?? null;
            if (
              this.isPrivyConfigured &&
              this.privySnapshot.ready &&
              this.privySnapshot.authenticated &&
              data.user.provider === "privy" &&
              currentPrivySub &&
              data.user.providerSubject !== currentPrivySub
            ) {
              this.storage?.removeItem(AUTH_TOKEN_STORAGE_KEY);
            } else {
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
        } else {
          this.storage?.removeItem(AUTH_TOKEN_STORAGE_KEY);
        }
      } catch {
        // Network error during restore keeps existing token intact until user/Privy reconciles
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
      if (this.wasPrivyAuthenticated) {
        this.wasPrivyAuthenticated = false;
        if (this.state.user?.provider === "privy" || !this.state.user) {
          this.syncEpoch += 1;
          this.inFlightSync = null;
          this.resolvedWalletBySub.clear();
          this.walletProvisionAttemptedSubs.clear();
          this.inFlightWalletProvisionBySub.clear();
          if (this.state.user?.provider === "privy") {
            this.storage?.removeItem(AUTH_TOKEN_STORAGE_KEY);
          }
          this.setState({
            user: this.state.user?.provider === "privy" ? null : this.state.user,
            wallet: this.state.user?.provider === "privy" ? null : this.state.wallet,
            syncError: null,
            activePrivySub: null,
            retrievedPrivyWalletAddress: null,
            stage:
              this.state.user && this.state.user.provider !== "privy"
                ? "authenticated"
                : "unauthenticated",
          });
        }
        return;
      }

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

    void this.syncPrivySession({
      allowWalletProvision: !this.autoWalletProvisionDisabled,
    }).catch(() => {
      // Recoverable failure state is already reflected on AuthControllerState.syncError
    });
  }

  private async resolveEmbeddedStellarWallet(
    epoch: number,
    options: { allowWalletProvision: boolean; isRetry: boolean }
  ): Promise<{ sub: string; address: string }> {
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
        this.setState({ activePrivySub: currentUser.id });

        const cachedWallet = this.resolvedWalletBySub.get(currentUser.id);
        const lookup = extractEmbeddedStellarWallet(currentUser);

        if (lookup.status === "found") {
          this.resolvedWalletBySub.set(currentUser.id, lookup.address);
          return { sub: currentUser.id, address: lookup.address };
        }
        if (lookup.status === "multiple") {
          throw mapSyncFailure(409, "MULTIPLE_EMBEDDED_STELLAR_WALLETS", undefined, currentUser.id);
        }
        if (lookup.status === "invalid") {
          throw mapSyncFailure(400, "INVALID_PRIVY_WALLET", lookup.reason, currentUser.id);
        }

        if (cachedWallet && isValidStellarPublicKey(cachedWallet)) {
          return { sub: currentUser.id, address: cachedWallet };
        }
      }

      // Ask Privy SDK to refresh user linkedAccounts once before waiting or provisioning
      if (!didCallRefreshUser && this.runtimeActions.refreshUser) {
        didCallRefreshUser = true;
        try {
          const refreshed = await this.runtimeActions.refreshUser();
          if (epoch !== this.syncEpoch) {
            throw new Error("Authentication state changed.");
          }
          if (refreshed?.id) {
            this.privySnapshot = { ...this.privySnapshot, user: refreshed };
            this.setState({ activePrivySub: refreshed.id });
            const refreshedLookup = extractEmbeddedStellarWallet(refreshed);
            if (refreshedLookup.status === "found") {
              this.resolvedWalletBySub.set(refreshed.id, refreshedLookup.address);
              return { sub: refreshed.id, address: refreshedLookup.address };
            }
            if (refreshedLookup.status === "multiple") {
              throw mapSyncFailure(
                409,
                "MULTIPLE_EMBEDDED_STELLAR_WALLETS",
                undefined,
                refreshed.id
              );
            }
            if (refreshedLookup.status === "invalid") {
              throw mapSyncFailure(400, "INVALID_PRIVY_WALLET", refreshedLookup.reason, refreshed.id);
            }
          }
        } catch (err) {
          if (isAuthSyncError(err)) throw err;
          // Ignore transient refreshUser failure and continue polling snapshot until deadline
        }
      }

      if (Date.now() >= deadline) {
        break;
      }
      await this.waitForHydrationTick(this.hydrationPollMs);
    }

    if (epoch !== this.syncEpoch) {
      throw new Error("Authentication state changed.");
    }

    const settledUser = this.privySnapshot.user;
    const sub = settledUser?.id ?? null;

    if (!sub) {
      throw mapSyncFailure(
        null,
        "PRIVY_USER_NOT_HYDRATED",
        "Privy user details did not finish loading in time. Please retry synchronization.",
        null
      );
    }

    // Re-check final snapshot
    const finalCheck = extractEmbeddedStellarWallet(settledUser);
    if (finalCheck.status === "found") {
      this.resolvedWalletBySub.set(sub, finalCheck.address);
      return { sub, address: finalCheck.address };
    }
    if (finalCheck.status === "multiple") {
      throw mapSyncFailure(409, "MULTIPLE_EMBEDDED_STELLAR_WALLETS", undefined, sub);
    }
    if (finalCheck.status === "invalid") {
      throw mapSyncFailure(400, "INVALID_PRIVY_WALLET", finalCheck.reason, sub);
    }

    // Provision embedded Stellar wallet at most once when allowed and no wallet exists
    const alreadyProvisioned = this.walletProvisionAttemptedSubs.has(sub);
    if (
      options.allowWalletProvision &&
      !this.autoWalletProvisionDisabled &&
      this.runtimeActions.createWallet &&
      !alreadyProvisioned &&
      !this.resolvedWalletBySub.has(sub)
    ) {

      let provisionPromise = this.inFlightWalletProvisionBySub.get(sub);
      if (!provisionPromise) {
        this.walletProvisionAttemptedSubs.add(sub);
        provisionPromise = (async () => {
          try {
            const created = await this.runtimeActions.createWallet!({ chainType: "stellar" });
            if (created.user?.id === sub) {
              this.privySnapshot = { ...this.privySnapshot, user: created.user };
              const fromUser = extractEmbeddedStellarWallet(created.user);
              if (fromUser.status === "found") {
                return fromUser.address;
              }
            }
            const directAddr = validateCreatedWalletRecord(created.wallet);
            if (directAddr) {
              return directAddr;
            }
            if (this.runtimeActions.refreshUser) {
              const refreshedAfterCreate = await this.runtimeActions.refreshUser();
              if (refreshedAfterCreate?.id === sub) {
                this.privySnapshot = { ...this.privySnapshot, user: refreshedAfterCreate };
                const afterCreateLookup = extractEmbeddedStellarWallet(refreshedAfterCreate);
                if (afterCreateLookup.status === "found") {
                  return afterCreateLookup.address;
                }
              }
            }
            return null;
          } catch {
            // If wallet was concurrently created, check refreshUser before failing
            if (this.runtimeActions.refreshUser) {
              try {
                const refreshed = await this.runtimeActions.refreshUser();
                if (refreshed?.id === sub) {
                  this.privySnapshot = { ...this.privySnapshot, user: refreshed };
                  const lookupAfterErr = extractEmbeddedStellarWallet(refreshed);
                  if (lookupAfterErr.status === "found") {
                    return lookupAfterErr.address;
                  }
                }
              } catch {
                // Fall through
              }
            }
            return null;
          } finally {
            this.inFlightWalletProvisionBySub.delete(sub);
          }
        })();
        this.inFlightWalletProvisionBySub.set(sub, provisionPromise);
      }

      const provisionedAddress = await provisionPromise;
      if (epoch !== this.syncEpoch) {
        throw new Error("Authentication state changed.");
      }
      if (provisionedAddress && isValidStellarPublicKey(provisionedAddress)) {
        this.resolvedWalletBySub.set(sub, provisionedAddress);
        return { sub, address: provisionedAddress };
      }
    }

    console.warn("[TrustFlow Auth] Authenticated Privy user has no eligible embedded Stellar wallet.", {
      privySubSuffix: sub.slice(-6),
      sawExternalStellarWallet: finalCheck.sawExternalStellarWallet,
      autoWalletProvisionDisabled: this.autoWalletProvisionDisabled,
    });
    if (this.autoWalletProvisionDisabled) {
      // TEMPORARY PHASE 2.2A TEST GUARD: Preserve Privy identity while blocking auto wallet creation
      throw mapSyncFailure(
        403,
        "NO_EMBEDDED_STELLAR_WALLET",
        "Privy Wallet Test Mode is active: automatic Stellar wallet creation was skipped. Your Privy identity is authenticated with no embedded Stellar wallet.",
        sub
      );
    }
    throw mapSyncFailure(403, "NO_EMBEDDED_STELLAR_WALLET", undefined, sub);
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

    // Already authenticated for this exact Privy user (non-retry)
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
    // TEMPORARY PHASE 2.2A TEST GUARD: Authoritative block against automatic wallet provisioning
    const allowWalletProvision =
      (options.allowWalletProvision ?? true) && !this.autoWalletProvisionDisabled;
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

        const { sub, address } = await this.resolveEmbeddedStellarWallet(epoch, {
          allowWalletProvision,
          isRetry,
        });

        if (epoch !== this.syncEpoch) return;

        // Re-verify wallet belongs to currently active Privy user
        const latestSub = this.privySnapshot.user?.id ?? sub;
        if (latestSub !== sub) {
          throw new Error("Privy user changed during synchronization.");
        }

        if (this.inFlightSync === entry) {
          this.inFlightSync.sub = sub;
        }

        this.setState({
          stage: "wallet_ready",
          activePrivySub: sub,
          retrievedPrivyWalletAddress: address,
        });

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

        this.setState({ stage: "backend_syncing" });

        let res: Response;
        try {
          res = await this.fetchFn(this.apiUrl("/api/auth/privy-sync"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accessToken,
              stellarAddress: address,
            }),
          });
        } catch {
          throw mapSyncFailure(null, "NETWORK_ERROR", undefined, sub);
        }

        if (epoch !== this.syncEpoch) return;

        let result: any = {};
        try {
          result = await res.json();
        } catch {
          result = {};
        }

        if (!res.ok) {
          throw mapSyncFailure(res.status, result.code, result.error, sub);
        }

        // Verify user did not switch while backend request was in flight
        const postSub = this.privySnapshot.user?.id ?? sub;
        if (epoch !== this.syncEpoch || postSub !== sub) {
          return;
        }

        this.storage?.setItem(AUTH_TOKEN_STORAGE_KEY, result.token);
        this.setState({
          stage: "authenticated",
          user: result.user,
          wallet: result.wallet,
          syncError: null,
          activePrivySub: sub,
          retrievedPrivyWalletAddress: result.user?.stellarAddress || address,
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
      allowWalletProvision: false,
      isRetry: true,
    });
  }

  public async syncPrivyUserDirect(data: {
    accessToken: string;
    stellarAddress?: string;
  }): Promise<void> {
    const res = await this.fetchFn(this.apiUrl("/api/auth/privy-sync"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessToken: data.accessToken,
        ...(data.stellarAddress ? { stellarAddress: data.stellarAddress } : {}),
      }),
    });
    const result = (await res.json()) as any;
    if (!res.ok) {
      throw new Error(result.error || "Failed to verify Privy authentication.");
    }
    this.storage?.setItem(AUTH_TOKEN_STORAGE_KEY, result.token);
    this.setState({
      stage: "authenticated",
      user: result.user,
      wallet: result.wallet,
      syncError: null,
      activePrivySub: result.user?.providerSubject ?? null,
      retrievedPrivyWalletAddress: result.user?.stellarAddress ?? null,
    });
  }

  public async sendOtpCode(email: string): Promise<{ success: boolean; message: string }> {
    if (this.isPrivyConfigured && this.runtimeActions.adapter) {
      await this.runtimeActions.adapter.sendEmailCode(email);
      return { success: true, message: `Verification code sent via Privy to ${email}.` };
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
      await this.syncPrivySession({
        allowWalletProvision: !this.autoWalletProvisionDisabled,
      });
      return;
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
      await this.syncPrivySession({
        allowWalletProvision: !this.autoWalletProvisionDisabled,
      });
      return;
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

    this.storage?.setItem(AUTH_TOKEN_STORAGE_KEY, data.token);
    this.setState({
      stage: "authenticated",
      user: data.user,
      wallet: data.wallet,
      syncError: null,
    });
  }

  public async linkExternalWallet(stellarAddress: string): Promise<void> {
    const res = await this.fetchFn(this.apiUrl("/api/auth/wallet/link"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.getAuthHeaders(),
      },
      body: JSON.stringify({ stellarAddress }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) {
      throw new Error(data.error || "Failed to link wallet.");
    }
    this.setState({
      user: data.user,
      wallet: data.wallet,
    });
  }

  public async refreshBalance(): Promise<void> {
    const storedToken = this.storage?.getItem(AUTH_TOKEN_STORAGE_KEY);
    if (!storedToken) return;
    const res = await this.fetchFn(this.apiUrl("/api/auth/me"), {
      headers: { Authorization: `Bearer ${storedToken}` },
    });
    if (res.ok) {
      const data = (await res.json()) as { wallet?: AuthenticatedWallet | null };
      if (data.wallet) {
        this.setState({ wallet: data.wallet });
      }
    }
  }

  public async logout(): Promise<void> {
    this.syncEpoch += 1;
    this.sessionEpoch += 1;
    this.inFlightSync = null;
    this.wasPrivyAuthenticated = false;
    this.resolvedWalletBySub.clear();
    this.walletProvisionAttemptedSubs.clear();
    this.inFlightWalletProvisionBySub.clear();

    const storedToken = this.storage?.getItem(AUTH_TOKEN_STORAGE_KEY);
    this.storage?.removeItem(AUTH_TOKEN_STORAGE_KEY);

    this.setState({
      stage: "unauthenticated",
      user: null,
      wallet: null,
      syncError: null,
      activePrivySub: null,
      retrievedPrivyWalletAddress: null,
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
      address: user.stellarAddress || "",
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
