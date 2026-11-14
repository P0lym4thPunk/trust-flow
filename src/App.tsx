import React, { useState, useEffect, useRef, useCallback } from "react";
import { MotionConfig } from "motion/react";
import { usePrivy } from "@privy-io/react-auth";
import { LandingPage } from "./components/LandingPage";
import { NavigationShell } from "./components/NavigationShell";
import { ConversationalWorkspace } from "./components/ConversationalWorkspace";
import { AgreementDetailRoom } from "./components/AgreementDetailRoom";
import { AgreementListView } from "./components/AgreementListView";
import { AuthModal } from "./components/AuthModal";
import { AuthProvider, useAuth } from "./lib/auth/AuthContext";
import { AgreementRecord, TransactionType } from "./types/agreement";
import {
  WalletAccount,
  connectFreighterWallet,
} from "./lib/stellar/wallet";
import {
  pollarPrivyAdapter,
  IS_PRIVY_CONFIGURED,
  PrivyAdapterProvider,
} from "./lib/auth/pollarPrivy";

function TrustFlowMain() {
  const [inApp, setInApp] = useState(false);
  const [activeTab, setActiveTab] = useState("workspace");
  const [isDark, setIsDark] = useState(true);
  const [agreements, setAgreements] = useState<AgreementRecord[]>([]);
  const [selectedAgreement, setSelectedAgreement] =
    useState<AgreementRecord | null>(null);
  const [workspaceInitialType, setWorkspaceInitialType] =
    useState<TransactionType>("WORK");
  const [walletNotice, setWalletNotice] = useState<string | null>(null);

  const {
    user,
    isAuthenticated,
    openAuthModal,
    closeAuthModal,
    getAuthHeaders,
    effectiveAccount,
    switchSandboxPersona,
    linkExternalWallet,
  } = useAuth();

  const prevAuthRef = useRef(isAuthenticated);

  // Sync dark theme class on documentElement
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDark]);

  // Enter workspace on sign in; return to landing page on sign out
  useEffect(() => {
    if (!prevAuthRef.current && isAuthenticated && !inApp) {
      setInApp(true);
      setActiveTab("workspace");
      setSelectedAgreement(null);
    } else if (prevAuthRef.current && !isAuthenticated) {
      setInApp(false);
      setAgreements([]);
      setSelectedAgreement(null);
    }
    prevAuthRef.current = isAuthenticated;
  }, [isAuthenticated, inApp]);

  // Fetch agreements strictly for authenticated caller
  const fetchAgreements = useCallback(async () => {
    if (!isAuthenticated) {
      setAgreements([]);
      return;
    }
    try {
      const res = await fetch("/api/agreements", {
        headers: { ...getAuthHeaders() },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load agreements (${res.status})`);
      }
      const data: AgreementRecord[] = await res.json();
      setAgreements(data);
      setSelectedAgreement((prev) =>
        prev ? data.find((a) => a.id === prev.id) || null : null
      );
    } catch (err: any) {
      console.error("Error fetching agreements:", err);
      setWalletNotice(err.message || "Unable to load agreements.");
    }
  }, [isAuthenticated, getAuthHeaders]);

  useEffect(() => {
    fetchAgreements();
  }, [fetchAgreements, user?.id, user?.stellarAddress]);

  const handleConnectRealWallet = async () => {
    setWalletNotice(null);
    try {
      const realAccount = await connectFreighterWallet();
      if (realAccount && realAccount.address) {
        await linkExternalWallet(realAccount.address);
      }
    } catch (err: any) {
      setWalletNotice(err.message || "Failed to connect Freighter wallet.");
    }
  };

  const handleAccountChange = async (account: WalletAccount) => {
    await switchSandboxPersona(account);
  };

  // Update local list strictly from authoritative backend-returned AgreementRecord
  const handleAgreementSynced = (updated: AgreementRecord) => {
    setSelectedAgreement(updated);
    setAgreements((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  };

  const handleLaunchApp = (type?: TransactionType) => {
    if (type) {
      setWorkspaceInitialType(type);
    }
    if (!isAuthenticated) {
      openAuthModal();
      return;
    }
    setInApp(true);
    setActiveTab("workspace");
    setSelectedAgreement(null);
  };

  const handleGetStarted = () => {
    if (isAuthenticated) {
      handleLaunchApp("WORK");
    } else {
      openAuthModal();
    }
  };

  const handleEnterDemo = () => {
    closeAuthModal();
    setInApp(true);
    setActiveTab("workspace");
    setSelectedAgreement(null);
  };

  return (
    <>
      {!inApp || !effectiveAccount ? (
        <LandingPage
          isDark={isDark}
          onToggleTheme={() => setIsDark(!isDark)}
          onGetStarted={handleGetStarted}
          onOpenApp={() => handleLaunchApp()}
        />
      ) : (
        <NavigationShell
          activeTab={activeTab}
          onTabChange={(tab) => {
            setSelectedAgreement(null);
            setActiveTab(tab);
          }}
          onReturnHome={() => {
            setSelectedAgreement(null);
            setInApp(false);
          }}
          currentAccount={effectiveAccount}
          onAccountChange={handleAccountChange}
          isSimulated={effectiveAccount.isSimulated}
          onConnectRealWallet={handleConnectRealWallet}
          walletNotice={walletNotice}
          onClearWalletNotice={() => setWalletNotice(null)}
          isDark={isDark}
          onToggleTheme={() => setIsDark(!isDark)}
        >
          {selectedAgreement ? (
            <AgreementDetailRoom
              agreement={selectedAgreement}
              currentAccount={effectiveAccount}
              onUpdateAgreement={handleAgreementSynced}
              onBack={() => setSelectedAgreement(null)}
            />
          ) : activeTab === "workspace" ? (
            <ConversationalWorkspace
              initialType={workspaceInitialType}
              currentUserAddress={effectiveAccount.address}
              currentUserName={effectiveAccount.displayName}
              agreements={agreements}
              onSelectAgreement={(agr) => setSelectedAgreement(agr)}
              onNavigateTab={(tab) => {
                setSelectedAgreement(null);
                setActiveTab(tab);
              }}
              onAgreementCreated={(newAgr) => {
                setAgreements((prev) => [newAgr, ...prev]);
                setSelectedAgreement(newAgr);
              }}
            />
          ) : (
            <AgreementListView
              agreements={agreements}
              activeFilter={activeTab}
              onFilterChange={(tab) => {
                setSelectedAgreement(null);
                setActiveTab(tab);
              }}
              onSelectAgreement={(agr) => setSelectedAgreement(agr)}
              onCreateNew={() => {
                setSelectedAgreement(null);
                setActiveTab("workspace");
              }}
            />
          )}
        </NavigationShell>
      )}
      <AuthModal onContinueDemo={handleEnterDemo} />
    </>
  );
}

function PrivyAuthWrapper({ children }: { children: React.ReactNode }) {
  const { getAccessToken } = usePrivy();
  return <AuthProvider getPrivyAccessToken={getAccessToken}>{children}</AuthProvider>;
}

export default function App() {
  if (IS_PRIVY_CONFIGURED && pollarPrivyAdapter) {
    return (
      <MotionConfig reducedMotion="user">
        <PrivyAdapterProvider adapter={pollarPrivyAdapter}>
          <PrivyAuthWrapper>
            <TrustFlowMain />
          </PrivyAuthWrapper>
        </PrivyAdapterProvider>
      </MotionConfig>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <TrustFlowMain />
      </AuthProvider>
    </MotionConfig>
  );
}
