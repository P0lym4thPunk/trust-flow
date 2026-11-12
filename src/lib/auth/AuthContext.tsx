import React, { createContext, useContext, useState, useEffect } from "react";
import { WalletAccount, SIMULATED_PROFILES } from "../stellar/wallet";

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  avatar: string;
  provider: "email_otp" | "google" | "privy";
  stellarAddress: string;
  createdAt: string;
  lastLoginAt: string;
}

export interface AuthenticatedWallet {
  address: string;
  network: "testnet";
  isEmbedded: boolean;
  balanceXLM: string;
  balanceUSDC: string;
}

interface AuthContextType {
  user: AuthenticatedUser | null;
  wallet: AuthenticatedWallet | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAuthModalOpen: boolean;
  openAuthModal: () => void;
  closeAuthModal: () => void;
  sendOtpCode: (email: string) => Promise<{ success: boolean; demoCode?: string; message?: string }>;
  verifyOtpCode: (email: string, code: string) => Promise<void>;
  loginWithGoogle: (mockProfile?: { email: string; name?: string }) => Promise<void>;
  syncPrivyUser: (data: { privyUserId: string; email?: string; stellarAddress?: string; displayName?: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  // Demo Mode controls (isolated from real identity)
  isDemoSandbox: boolean;
  setIsDemoSandbox: (active: boolean) => void;
  selectedDemoPersona: WalletAccount;
  setSelectedDemoPersona: (persona: WalletAccount) => void;
  effectiveAccount: WalletAccount;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = "trustflow_auth_token";

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [wallet, setWallet] = useState<AuthenticatedWallet | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Demo Sandbox State (Alice, Bob, Charlie)
  const [isDemoSandbox, setIsDemoSandbox] = useState(false);
  const [selectedDemoPersona, setSelectedDemoPersona] = useState<WalletAccount>(SIMULATED_PROFILES[0]);

  // Check stored session on mount
  useEffect(() => {
    const initSession = async () => {
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
    try {
      const res = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${storedToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.wallet) {
          setWallet(data.wallet);
        }
      }
    } catch (err) {
      console.warn("Balance refresh notice:", err);
    }
  };

  const sendOtpCode = async (email: string) => {
    const res = await fetch("/api/auth/otp/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to send verification code");
    }
    return data;
  };

  const verifyOtpCode = async (email: string, code: string) => {
    const res = await fetch("/api/auth/otp/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to verify code");
    }

    localStorage.setItem(TOKEN_KEY, data.token);
    setUser(data.user);
    setWallet(data.wallet);
    setIsDemoSandbox(false);
    setIsAuthModalOpen(false);
  };

  const loginWithGoogle = async (mockProfile?: { email: string; name?: string }) => {
    const payload = mockProfile || {
      email: "demo.stellar.user@gmail.com",
      displayName: "Alex Rivera",
      avatar: "🌟",
    };

    const res = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed Google login");
    }

    localStorage.setItem(TOKEN_KEY, data.token);
    setUser(data.user);
    setWallet(data.wallet);
    setIsDemoSandbox(false);
    setIsAuthModalOpen(false);
  };

  const syncPrivyUser = async (data: {
    privyUserId: string;
    email?: string;
    stellarAddress?: string;
    displayName?: string;
  }) => {
    const res = await fetch("/api/auth/privy-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || "Failed to sync Privy authentication");
    }

    localStorage.setItem(TOKEN_KEY, result.token);
    setUser(result.user);
    setWallet(result.wallet);
    setIsDemoSandbox(false);
    setIsAuthModalOpen(false);
  };

  const logout = async () => {
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
    setIsDemoSandbox(true); // Default to simulated sandbox persona on logout
  };

  // Compute effective active account for agreement display
  const effectiveAccount: WalletAccount = isDemoSandbox || !user || !wallet
    ? selectedDemoPersona
    : {
        id: user.id,
        email: user.email,
        address: wallet.address,
        displayName: `${user.displayName} (You)`,
        role: "PAYER",
        avatar: user.avatar,
        balanceXLM: wallet.balanceXLM,
        balanceUSDC: wallet.balanceUSDC,
        isSimulated: false,
        isEmbedded: true,
        provider: user.provider,
      };

  return (
    <AuthContext.Provider
      value={{
        user,
        wallet,
        isLoading,
        isAuthenticated: !!user,
        isAuthModalOpen,
        openAuthModal: () => setIsAuthModalOpen(true),
        closeAuthModal: () => setIsAuthModalOpen(false),
        sendOtpCode,
        verifyOtpCode,
        loginWithGoogle,
        syncPrivyUser,
        logout,
        refreshBalance,
        isDemoSandbox,
        setIsDemoSandbox,
        selectedDemoPersona,
        setSelectedDemoPersona,
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
