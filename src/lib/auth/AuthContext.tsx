import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { WalletAccount, SIMULATED_PROFILES } from "../stellar/wallet";
import { pollarPrivyAdapter, IS_PRIVY_CONFIGURED } from "./pollarPrivy";

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  displayName: string;
  avatar: string;
  provider: "email_otp" | "google" | "privy" | "dev_sandbox";
  authVerified: boolean;
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

interface AuthContextType {
  user: AuthenticatedUser | null;
  wallet: AuthenticatedWallet | null;
  capabilities: AuthCapabilities;
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
  enterSandbox: (personaKey?: "alice" | "bob" | "charlie") => Promise<void>;
  switchSandboxPersona: (account: WalletAccount) => Promise<void>;
  linkExternalWallet: (stellarAddress: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  isDemoSandbox: boolean;
  selectedDemoPersona: WalletAccount;
  effectiveAccount: WalletAccount | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = "trustflow_auth_token";

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
}> = ({ children, getPrivyAccessToken }) => {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [wallet, setWallet] = useState<AuthenticatedWallet | null>(null);
  const [capabilities, setCapabilities] = useState<AuthCapabilities>({
    emailOtpConfigured: false,
    googleConfigured: false,
    privyConfigured: IS_PRIVY_CONFIGURED,
    devSandboxEnabled: import.meta.env.VITE_ALLOW_DEV_SANDBOX !== "false" && !import.meta.env.PROD,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  const isDemoSandbox = Boolean(user?.isSandbox);
  const selectedDemoPersona: WalletAccount =
    user?.isSandbox && user.stellarAddress
      ? personaProfileFromKey(personaKeyFromAddress(user.stellarAddress))
      : SIMULATED_PROFILES[0];

  const getAuthHeaders = useCallback((): Record<string, string> => {
    const token = localStorage.getItem(TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  // Load server auth capabilities & validate stored session on mount
  useEffect(() => {
    const initSession = async () => {
      try {
        const capRes = await fetch("/api/auth/capabilities");
        if (capRes.ok) {
          const capData = await capRes.json();
          setCapabilities(capData);
        }
      } catch (err) {
        console.warn("Unable to fetch auth capabilities:", err);
      }

      const storedToken = localStorage.getItem(TOKEN_KEY);
      if (!storedToken) {
        setIsLoading(false);
        return;
      }

      try {
        const res = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${storedToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.user) {
            setUser(data.user);
            setWallet(data.wallet);
          } else {
            localStorage.removeItem(TOKEN_KEY);
          }
        } else {
          localStorage.removeItem(TOKEN_KEY);
        }
      } catch (err) {
        console.error("Failed to restore authentication session:", err);
      } finally {
        setIsLoading(false);
      }
    };

    initSession();
  }, []);

  const refreshBalance = async () => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    if (!storedToken) return;
    const res = await fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${storedToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.wallet) {
        setWallet(data.wallet);
      }
    }
  };

  const syncPrivyUser = async (data: {
    accessToken: string;
    stellarAddress?: string;
    email?: string;
    displayName?: string;
  }) => {
    const res = await fetch("/api/auth/privy-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || "Failed to verify Privy authentication.");
    }

    localStorage.setItem(TOKEN_KEY, result.token);
    setUser(result.user);
    setWallet(result.wallet);
    setIsAuthModalOpen(false);
  };

  const sendOtpCode = async (email: string) => {
    if (IS_PRIVY_CONFIGURED && pollarPrivyAdapter) {
      await pollarPrivyAdapter.sendEmailCode(email);
      return { success: true, message: `Verification code sent via Privy to ${email}.` };
    }
    const res = await fetch("/api/auth/otp/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to send verification code.");
    }
    return data;
  };

  const verifyOtpCode = async (email: string, code: string) => {
    if (IS_PRIVY_CONFIGURED && pollarPrivyAdapter) {
      await pollarPrivyAdapter.verifyEmailCode(code);
      const conn = await pollarPrivyAdapter.connect();
      const accessToken = getPrivyAccessToken ? await getPrivyAccessToken() : null;
      if (!accessToken) {
        throw new Error("Privy access token could not be retrieved after login.");
      }
      await syncPrivyUser({
        accessToken,
        email,
        stellarAddress: conn.address,
        displayName: email.split("@")[0],
      });
      return;
    }

    const res = await fetch("/api/auth/otp/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to verify code.");
    }

    localStorage.setItem(TOKEN_KEY, data.token);
    setUser(data.user);
    setWallet(data.wallet);
    setIsAuthModalOpen(false);
  };

  const loginWithGoogle = async (idToken?: string) => {
    if (IS_PRIVY_CONFIGURED && pollarPrivyAdapter) {
      await pollarPrivyAdapter.loginWithOAuth("google");
      const conn = await pollarPrivyAdapter.connect();
      const accessToken = getPrivyAccessToken ? await getPrivyAccessToken() : null;
      if (!accessToken) {
        throw new Error("Privy access token could not be retrieved after Google OAuth.");
      }
      await syncPrivyUser({
        accessToken,
        stellarAddress: conn.address,
      });
      return;
    }

    if (!idToken) {
      throw new Error(
        capabilities.googleConfigured
          ? "Google sign-in requires a verified Google ID token."
          : "Google Sign-In is not configured on this server. Use Email Sign-In or Test Sandbox Mode in development."
      );
    }

    const res = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Google verification failed.");
    }

    localStorage.setItem(TOKEN_KEY, data.token);
    setUser(data.user);
    setWallet(data.wallet);
    setIsAuthModalOpen(false);
  };

  const enterSandbox = async (personaKey: "alice" | "bob" | "charlie" = "alice") => {
    const res = await fetch("/api/auth/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona: personaKey }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Development sandbox is unavailable.");
    }

    localStorage.setItem(TOKEN_KEY, data.token);
    setUser(data.user);
    setWallet(data.wallet);
    setIsAuthModalOpen(false);
  };

  const switchSandboxPersona = async (account: WalletAccount) => {
    await enterSandbox(personaKeyFromAddress(account.address));
  };

  const linkExternalWallet = async (stellarAddress: string) => {
    const res = await fetch("/api/auth/wallet/link", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
      },
      body: JSON.stringify({ stellarAddress }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to link wallet.");
    }
    setUser(data.user);
    setWallet(data.wallet);
  };

  const logout = async () => {
    if (IS_PRIVY_CONFIGURED && pollarPrivyAdapter) {
      try {
        await pollarPrivyAdapter.disconnect();
      } catch (err) {
        console.warn("Privy disconnect notice:", err);
      }
    }
    const storedToken = localStorage.getItem(TOKEN_KEY);
    if (storedToken) {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${storedToken}` },
        });
      } catch (err) {
        console.warn("Logout error:", err);
      }
    }
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
    setWallet(null);
  };

  const effectiveAccount: WalletAccount | null = !user
    ? null
    : user.isSandbox
    ? {
        ...personaProfileFromKey(personaKeyFromAddress(user.stellarAddress || "")),
        id: user.id,
        email: user.email || undefined,
        balanceXLM: wallet?.balanceXLM || "0.00",
        balanceUSDC: wallet?.balanceUSDC || "0.00",
        isSimulated: true,
        provider: "simulated",
      }
    : {
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

  return (
    <AuthContext.Provider
      value={{
        user,
        wallet,
        capabilities,
        isLoading,
        isAuthenticated: Boolean(user),
        isPrivyConfigured: IS_PRIVY_CONFIGURED,
        isAuthModalOpen,
        openAuthModal: () => setIsAuthModalOpen(true),
        closeAuthModal: () => setIsAuthModalOpen(false),
        getAuthHeaders,
        sendOtpCode,
        verifyOtpCode,
        loginWithGoogle,
        syncPrivyUser,
        enterSandbox,
        switchSandboxPersona,
        linkExternalWallet,
        logout,
        refreshBalance,
        isDemoSandbox,
        selectedDemoPersona,
        effectiveAccount,
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
