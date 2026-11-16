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
  type PrivyUserLike,
} from "./privyLifecycle";

export type {
  AuthenticatedUser,
  AuthenticatedWallet,
  AuthCapabilities,
  AuthLifecycleStage,
  AuthSyncError,
  PrivyUserLike,
};

export interface PrivyRuntimeInput {
  ready: boolean;
  authenticated: boolean;
  user: PrivyUserLike | null;
  getAccessToken?: () => Promise<string | null>;
  refreshUser?: () => Promise<PrivyUserLike | null | undefined>;
  createWallet?: (input: { chainType: "stellar" }) => Promise<any>;
  logout?: () => Promise<void>;
}

interface AuthContextType {
  user: AuthenticatedUser | null;
  wallet: AuthenticatedWallet | null;
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
  logout: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  isDemoSandbox: boolean;
  selectedDemoPersona: WalletAccount;
  effectiveAccount: WalletAccount | null;
  // TEMPORARY PHASE 2.2A TEST GUARD
  activePrivySub: string | null;
  isPrivyWalletTestMode: boolean;
}

// TEMPORARY PHASE 2.2A TEST GUARD: Dev-only opt-in to skip automatic client-side Stellar wallet creation
export const IS_PRIVY_WALLET_TEST_MODE =
  !import.meta.env.PROD && import.meta.env.VITE_PRIVY_WALLET_TEST_MODE === "true";

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
}> = ({ children, getPrivyAccessToken, privyRuntime }) => {
  const controllerRef = useRef<TrustFlowAuthController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new TrustFlowAuthController({
      isPrivyConfigured: IS_PRIVY_CONFIGURED,
      defaultDevSandboxEnabled:
        import.meta.env.VITE_ALLOW_DEV_SANDBOX !== "false" && !import.meta.env.PROD,
      // TEMPORARY PHASE 2.2A TEST GUARD
      disableAutoWalletProvision: IS_PRIVY_WALLET_TEST_MODE,
      isProduction: import.meta.env.PROD,
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
      createWallet:
        !IS_PRIVY_WALLET_TEST_MODE && runtimeRef.current.privyRuntime?.createWallet
          ? (input) => runtimeRef.current.privyRuntime!.createWallet!(input)
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
    privyRuntime?.createWallet,
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
    if (!IS_PRIVY_CONFIGURED || !privyRuntime) return;
    controller.updatePrivySnapshot({
      ready: privyRuntime.ready,
      authenticated: privyRuntime.authenticated,
      user: privyRuntime.user,
    });
  }, [
    controller,
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
        capabilities: authState.capabilities,
        authStage: authState.stage,
        syncError: authState.syncError,
        isLoading: authState.isLoading,
        isAuthenticated: authState.isAuthenticated,
        isPrivyConfigured: IS_PRIVY_CONFIGURED,
        isAuthModalOpen,
        openAuthModal: () => setIsAuthModalOpen(true),
        closeAuthModal: () => setIsAuthModalOpen(false),
        getAuthHeaders,
        sendOtpCode,
        verifyOtpCode,
        loginWithGoogle,
        syncPrivyUser,
        retryPrivySync,
        enterSandbox,
        switchSandboxPersona,
        linkExternalWallet,
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
