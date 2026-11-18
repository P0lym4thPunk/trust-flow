import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { WalletAccount, SIMULATED_PROFILES } from "../stellar/wallet";
import { pollarPrivyAdapter, IS_PRIVY_CONFIGURED } from "./pollarPrivy";
import {
  TrustFlowAuthController,
  type AuthenticatedUser,
  type AuthenticatedWallet,
  type AuthCapabilities,
  type AuthLifecycleStage,
  type AuthSyncError,
  type AuthControllerState,
  type ExternalWalletChallengeResult,
  type PrivyUserLike,
  type UserWalletRecord,
} from "./privyLifecycle";
import type { StellarWalletAdapter, StellarWalletProviderId } from "../stellar/walletsKit";

export type {
  AuthenticatedUser,
  AuthenticatedWallet,
  AuthCapabilities,
  AuthLifecycleStage,
  AuthSyncError,
  PrivyUserLike,
  UserWalletRecord,
};

export interface PrivyLinkBridgeHandlers {
  onLinkSuccess: (user?: PrivyUserLike | null) => Promise<void>;
  onLinkError: (error: unknown) => void;
  onLinkCancel?: () => void;
}

export interface PrivyRuntimeInput {
  ready: boolean;
  authenticated: boolean;
  user: PrivyUserLike | null;
  getAccessToken?: () => Promise<string | null>;
  refreshUser?: () => Promise<PrivyUserLike | null | undefined>;
  linkEmail?: () => void | Promise<void>;
  linkGoogle?: () => void | Promise<void>;
  logout?: () => Promise<void>;
  linkBridgeRef?: React.MutableRefObject<PrivyLinkBridgeHandlers | null>;
}

interface AuthContextType {
  user: AuthenticatedUser | null;
  wallet: AuthenticatedWallet | null;
  privyUser: PrivyUserLike | null;
  capabilities: AuthCapabilities;
  authStage: AuthLifecycleStage;
  syncError: AuthSyncError | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isPrivyConfigured: boolean;
  isAuthModalOpen: boolean;
  openAuthModal: () => void;
  closeAuthModal: () => void;
  getAuthHeaders: () => Record<string, string>;
  authenticatedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  sendOtpCode: (email: string) => Promise<{ success: boolean; message: string }>;
  verifyOtpCode: (email: string, code: string) => Promise<void>;
  loginWithGoogle: (idToken?: string) => Promise<void>;
  syncPrivyUser: (data: {
    accessToken: string;
    stellarAddress?: string;
    email?: string;
    displayName?: string;
  }) => Promise<void>;
  retryPrivySync: () => Promise<void>;
  enterSandbox: (personaKey?: "alice" | "bob" | "charlie") => Promise<void>;
  switchSandboxPersona: (account: WalletAccount) => Promise<void>;
  linkExternalWallet: (stellarAddress: string) => Promise<void>;
  linkExternalWalletWithFreighter: () => Promise<UserWalletRecord>;
  requestExternalWalletChallenge: (
    address: string,
    provider: string
  ) => Promise<ExternalWalletChallengeResult>;
  completeExternalWalletVerification: (params: {
    challengeId: string;
    address: string;
    signature: string;
  }) => Promise<UserWalletRecord>;
  linkExternalWalletWithProvider: (
    providerId: StellarWalletProviderId,
    adapter?: StellarWalletAdapter
  ) => Promise<UserWalletRecord>;
  unlinkExternalWallet: (walletId: string) => Promise<void>;
  linkPrivyEmail: () => Promise<void>;
  linkPrivyGoogle: () => Promise<void>;
  cancelPrivyLink: () => void;
  privyLinkingBusy: boolean;
  privyLinkingError: string | null;
  clearPrivyLinkError: () => void;
  logout: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  isDemoSandbox: boolean;
  selectedDemoPersona: WalletAccount;
  effectiveAccount: WalletAccount | null;
  // TEMPORARY PHASE 2.2A TEST GUARD
  activePrivySub: string | null;
  isPrivyWalletTestMode: boolean;
}

const viteEnv = (import.meta as { env?: { PROD?: boolean; VITE_PRIVY_WALLET_TEST_MODE?: string; VITE_ALLOW_DEV_SANDBOX?: string } }).env;

// TEMPORARY PHASE 2.2A TEST GUARD: Dev-only opt-in to skip automatic Stellar wallet creation
export const IS_PRIVY_WALLET_TEST_MODE =
  !viteEnv?.PROD && viteEnv?.VITE_PRIVY_WALLET_TEST_MODE === "true";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function personaKeyFromAddress(address: string): "alice" | "bob" | "charlie" {
  if (address === SIMULATED_PROFILES[1].address) return "bob";
  if (address === SIMULATED_PROFILES[2].address) return "charlie";
  return "alice";
}

function personaProfileFromKey(key: "alice" | "bob" | "charlie"): WalletAccount {
  if (key === "bob") return SIMULATED_PROFILES[1];
  if (key === "charlie") return SIMULATED_PROFILES[2];
  return SIMULATED_PROFILES[0];
}

export const AuthProvider: React.FC<{
  children: React.ReactNode;
  getPrivyAccessToken?: () => Promise<string | null>;
  privyRuntime?: PrivyRuntimeInput;
  isPrivyConfiguredOverride?: boolean;
  fetchFn?: typeof fetch;
}> = ({ children, getPrivyAccessToken, privyRuntime, isPrivyConfiguredOverride, fetchFn }) => {
  const effectiveIsPrivyConfigured = isPrivyConfiguredOverride ?? IS_PRIVY_CONFIGURED;
  const controllerRef = useRef<TrustFlowAuthController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new TrustFlowAuthController({
      isPrivyConfigured: effectiveIsPrivyConfigured,
      defaultDevSandboxEnabled:
        viteEnv?.VITE_ALLOW_DEV_SANDBOX !== "false" && !viteEnv?.PROD,
      disableAutoWalletProvision: IS_PRIVY_WALLET_TEST_MODE,
      isProduction: Boolean(viteEnv?.PROD),
      fetchFn,
    });
  }
  const controller = controllerRef.current;

  const [authState, setAuthState] = useState<AuthControllerState>(() => controller.getState());
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  const runtimeRef = useRef({
    getPrivyAccessToken,
    privyRuntime,
  });
  runtimeRef.current = { getPrivyAccessToken, privyRuntime };

  // Wire Privy link callbacks ref so outer PrivyAuthWrapper useLinkAccount notifies this controller
  useEffect(() => {
    if (!privyRuntime?.linkBridgeRef) return;
    privyRuntime.linkBridgeRef.current = {
      onLinkSuccess: (linkedUser) => controller.handlePrivyLinkSuccess(linkedUser),
      onLinkError: (error) => controller.handlePrivyLinkError(error),
      onLinkCancel: () => controller.handlePrivyLinkCancelled(),
    };
    return () => {
      if (privyRuntime.linkBridgeRef) {
        privyRuntime.linkBridgeRef.current = null;
      }
    };
  }, [controller, privyRuntime?.linkBridgeRef]);

  // Keep latest Privy SDK actions wired without tearing down the controller
  useEffect(() => {
    controller.setRuntimeActions({
      adapter: pollarPrivyAdapter,
      getAccessToken: () => {
        const fn =
          runtimeRef.current.privyRuntime?.getAccessToken ||
          runtimeRef.current.getPrivyAccessToken;
        return fn ? fn() : Promise.resolve(null);
      },
      refreshUser: runtimeRef.current.privyRuntime?.refreshUser
        ? () => runtimeRef.current.privyRuntime!.refreshUser!()
        : undefined,
      linkEmail: runtimeRef.current.privyRuntime?.linkEmail
        ? () => runtimeRef.current.privyRuntime!.linkEmail!()
        : undefined,
      linkGoogle: runtimeRef.current.privyRuntime?.linkGoogle
        ? () => runtimeRef.current.privyRuntime!.linkGoogle!()
        : undefined,
      logout: runtimeRef.current.privyRuntime?.logout
        ? () => runtimeRef.current.privyRuntime!.logout!()
        : undefined,
    });
  }, [
    controller,
    getPrivyAccessToken,
    privyRuntime?.getAccessToken,
    privyRuntime?.refreshUser,
    privyRuntime?.linkEmail,
    privyRuntime?.linkGoogle,
    privyRuntime?.logout,
  ]);

  // Subscribe to controller state updates and restore existing session / capabilities once on mount
  useEffect(() => {
    const unsubscribe = controller.subscribe((nextState) => {
      setAuthState(nextState);
    });
    void controller.initSession();

    const unsubscribeAdapter =
      IS_PRIVY_CONFIGURED && pollarPrivyAdapter
        ? pollarPrivyAdapter.onProviderAuthChange?.((providerState) => {
            controller.handleAdapterAuthSignal(providerState);
          })
        : undefined;

    return () => {
      unsubscribeAdapter?.();
      unsubscribe();
    };
  }, [controller]);

  // Forward reactive Privy readiness, auth status, and user linkedAccounts snapshots
  useEffect(() => {
    if (!effectiveIsPrivyConfigured || !privyRuntime) return;
    controller.updatePrivySnapshot({
      ready: privyRuntime.ready,
      authenticated: privyRuntime.authenticated,
      user: privyRuntime.user,
    });
  }, [
    controller,
    effectiveIsPrivyConfigured,
    privyRuntime?.ready,
    privyRuntime?.authenticated,
    privyRuntime?.user,
  ]);

  const user = authState.user;
  const wallet = authState.wallet;
  const isDemoSandbox = Boolean(user?.isSandbox);
  const selectedDemoPersona: WalletAccount =
    user?.isSandbox && user.stellarAddress
      ? personaProfileFromKey(personaKeyFromAddress(user.stellarAddress))
      : SIMULATED_PROFILES[0];

  const getAuthHeaders = useCallback((): Record<string, string> => {
    return controller.getAuthHeaders();
  }, [controller]);

  const authenticatedFetch = useCallback(
    (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      return controller.authenticatedFetch(input, init);
    },
    [controller]
  );

  const refreshBalance = useCallback(async () => {
    await controller.refreshBalance();
  }, [controller]);

  const syncPrivyUser = useCallback(
    async (data: {
      accessToken: string;
      stellarAddress?: string;
      email?: string;
      displayName?: string;
    }) => {
      await controller.syncPrivyUserDirect({
        accessToken: data.accessToken,
        stellarAddress: data.stellarAddress,
      });
      setIsAuthModalOpen(false);
    },
    [controller]
  );

  const retryPrivySync = useCallback(async () => {
    await controller.retryPrivySync();
    setIsAuthModalOpen(false);
  }, [controller]);

  const sendOtpCode = useCallback(
    async (email: string) => {
      return controller.sendOtpCode(email);
    },
    [controller]
  );

  const verifyOtpCode = useCallback(
    async (email: string, code: string) => {
      await controller.verifyOtpCode(email, code);
      setIsAuthModalOpen(false);
    },
    [controller]
  );

  const loginWithGoogle = useCallback(
    async (idToken?: string) => {
      await controller.loginWithGoogle(idToken);
      setIsAuthModalOpen(false);
    },
    [controller]
  );

  const enterSandbox = useCallback(
    async (personaKey: "alice" | "bob" | "charlie" = "alice") => {
      await controller.enterSandbox(personaKey);
      setIsAuthModalOpen(false);
    },
    [controller]
  );

  const switchSandboxPersona = useCallback(
    async (account: WalletAccount) => {
      await enterSandbox(personaKeyFromAddress(account.address));
    },
    [enterSandbox]
  );

  const linkExternalWallet = useCallback(
    async (stellarAddress: string) => {
      await controller.linkExternalWallet(stellarAddress);
    },
    [controller]
  );

  const linkExternalWalletWithFreighter = useCallback(async () => {
    return controller.linkExternalWalletWithFreighter();
  }, [controller]);

  const requestExternalWalletChallenge = useCallback(
    async (address: string, provider: string) => {
      return controller.requestExternalWalletChallenge(address, provider);
    },
    [controller]
  );

  const completeExternalWalletVerification = useCallback(
    async (params: { challengeId: string; address: string; signature: string }) => {
      return controller.completeExternalWalletVerification(params);
    },
    [controller]
  );

  const linkExternalWalletWithProvider = useCallback(
    async (providerId: StellarWalletProviderId, adapter?: StellarWalletAdapter) => {
      return controller.linkExternalWalletWithProvider(providerId, adapter);
    },
    [controller]
  );

  const unlinkExternalWallet = useCallback(
    async (walletId: string) => {
      await controller.unlinkExternalWallet(walletId);
    },
    [controller]
  );

  const linkPrivyEmail = useCallback(async () => {
    await controller.startPrivyEmailLink();
  }, [controller]);

  const linkPrivyGoogle = useCallback(async () => {
    await controller.startPrivyGoogleLink();
  }, [controller]);

  const cancelPrivyLink = useCallback(() => {
    controller.handlePrivyLinkCancelled();
  }, [controller]);

  const clearPrivyLinkError = useCallback(() => {
    controller.clearPrivyLinkError();
  }, [controller]);

  const logout = useCallback(async () => {
    await controller.logout();
  }, [controller]);

  const effectiveAccount = TrustFlowAuthController.buildEffectiveAccount(
    user,
    wallet,
    SIMULATED_PROFILES
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        wallet,
        privyUser: privyRuntime?.user ?? null,
        capabilities: authState.capabilities,
        authStage: authState.stage,
        syncError: authState.syncError,
        isLoading: authState.isLoading,
        isAuthenticated: authState.isAuthenticated,
        isPrivyConfigured: effectiveIsPrivyConfigured,
        isAuthModalOpen,
        openAuthModal: () => setIsAuthModalOpen(true),
        closeAuthModal: () => setIsAuthModalOpen(false),
        getAuthHeaders,
        authenticatedFetch,
        sendOtpCode,
        verifyOtpCode,
        loginWithGoogle,
        syncPrivyUser,
        retryPrivySync,
        enterSandbox,
        switchSandboxPersona,
        linkExternalWallet,
        linkExternalWalletWithFreighter,
        requestExternalWalletChallenge,
        completeExternalWalletVerification,
        linkExternalWalletWithProvider,
        unlinkExternalWallet,
        linkPrivyEmail,
        linkPrivyGoogle,
        cancelPrivyLink,
        privyLinkingBusy: authState.privyLinkingBusy,
        privyLinkingError: authState.privyLinkingError,
        clearPrivyLinkError,
        logout,
        refreshBalance,
        isDemoSandbox,
        selectedDemoPersona,
        effectiveAccount,
        activePrivySub: authState.activePrivySub,
        isPrivyWalletTestMode: authState.autoWalletProvisionDisabled,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
