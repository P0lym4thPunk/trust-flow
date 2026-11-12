import React, { createContext, useContext, useState, useEffect } from "react";
import { Account, TransactionBuilder, Operation } from "@stellar/stellar-sdk";
import { WalletAccount, SIMULATED_PROFILES } from "../stellar/wallet";
import { STELLAR_TESTNET_CONFIG } from "../stellar/config";
import { pollarPrivyAdapter, IS_PRIVY_CONFIGURED } from "./pollarPrivy";

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
  isPrivyConfigured: boolean;
  isAuthModalOpen: boolean;
  openAuthModal: () => void;
  closeAuthModal: () => void;
  sendOtpCode: (email: string) => Promise<{ success: boolean; demoCode?: string; message?: string }>;
  verifyOtpCode: (email: string, code: string) => Promise<void>;
  loginWithGoogle: (mockProfile?: { email: string; name?: string }) => Promise<void>;
  syncPrivyUser: (data: { privyUserId: string; email?: string; stellarAddress?: string; displayName?: string }) => Promise<void>;
  signTestTransaction: () => Promise<{ signedTxXdr: string; txHash: string; status: string }>;
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
    if (IS_PRIVY_CONFIGURED && pollarPrivyAdapter) {
      await pollarPrivyAdapter.sendEmailCode(email);
      return { success: true, message: `Verification code sent via Privy to ${email}` };
    }
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
    if (IS_PRIVY_CONFIGURED && pollarPrivyAdapter) {
      await pollarPrivyAdapter.verifyEmailCode(code);
      const conn = await pollarPrivyAdapter.connect();
      const stellarAddress = conn.address;
      await syncPrivyUser({
        privyUserId: `privy-${stellarAddress.slice(0, 10)}`,
        email,
        stellarAddress,
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
      throw new Error(data.error || "Failed to verify code");
    }

    localStorage.setItem(TOKEN_KEY, data.token);
    setUser(data.user);
    setWallet(data.wallet);
    setIsDemoSandbox(false);
    setIsAuthModalOpen(false);
  };

  const loginWithGoogle = async (mockProfile?: { email: string; name?: string }) => {
    if (IS_PRIVY_CONFIGURED && pollarPrivyAdapter) {
      await pollarPrivyAdapter.loginWithOAuth("google");
      const conn = await pollarPrivyAdapter.connect();
      const stellarAddress = conn.address;
      await syncPrivyUser({
        privyUserId: `privy-${stellarAddress.slice(0, 10)}`,
        email: mockProfile?.email || "privy.user@gmail.com",
        stellarAddress,
        displayName: mockProfile?.name || "Stellar User",
      });
      return;
    }

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

  const signTestTransaction = async () => {
    const targetAddress = effectiveAccount.address;
    let sequence = "1";
    try {
      const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${targetAddress}`);
      if (res.ok) {
        const data = await res.json();
        sequence = data.sequence || "1";
      }
    } catch {
      // fallback sequence
    }

    const account = new Account(targetAddress, sequence);
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: STELLAR_TESTNET_CONFIG.networkPassphrase,
    })
      .addOperation(
        Operation.manageData({
          name: "trustflow_auth_test",
          value: Buffer.from("authorized"),
        })
      )
      .setTimeout(60)
      .build();

    const txHashHex = Buffer.from(tx.hash()).toString("hex");

    if (IS_PRIVY_CONFIGURED && pollarPrivyAdapter && typeof pollarPrivyAdapter.signTransaction === "function") {
      const result = await pollarPrivyAdapter.signTransaction(tx.toXDR(), {
        networkPassphrase: STELLAR_TESTNET_CONFIG.networkPassphrase,
      });
      return {
        signedTxXdr: result.signedTxXdr,
        txHash: txHashHex,
        status: "CONFIRMED_USER_AUTHORIZED",
      };
    }

    return {
      signedTxXdr: tx.toXDR(),
      txHash: txHashHex,
      status: "SIMULATED_TESTNET_AUTHORIZED",
    };
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
        isPrivyConfigured: IS_PRIVY_CONFIGURED,
        closeAuthModal: () => setIsAuthModalOpen(false),
        sendOtpCode,
        verifyOtpCode,
        loginWithGoogle,
        syncPrivyUser,
        signTestTransaction,
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
