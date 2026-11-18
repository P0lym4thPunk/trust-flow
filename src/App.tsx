import React, { useState, useEffect, useRef, useCallback } from "react";
import { MotionConfig } from "motion/react";
import { useLinkAccount, useModalStatus, usePrivy, useUser } from "@privy-io/react-auth";
import { LandingPage } from "./components/LandingPage";
import { NavigationShell } from "./components/NavigationShell";
import { ConversationalWorkspace } from "./components/ConversationalWorkspace";
import { AgreementDetailRoom } from "./components/AgreementDetailRoom";
import { AgreementListView } from "./components/AgreementListView";
import { AuthModal } from "./components/AuthModal";
import { WalletPickerModal } from "./components/WalletPickerModal";
import {
  AuthProvider,
  IS_PRIVY_WALLET_TEST_MODE,
  useAuth,
  type PrivyLinkBridgeHandlers,
} from "./lib/auth/AuthContext";
import { AgreementRecord, TransactionType } from "./types/agreement";
import { WalletAccount } from "./lib/stellar/wallet";
import { formatStellarProviderName } from "./lib/stellar/walletsKit";
import {
  pollarPrivyAdapter,
  IS_PRIVY_CONFIGURED,
  PrivyAdapterProvider,
} from "./lib/auth/pollarPrivy";

// TEMPORARY PHASE 2.2A STEP 6 DEV-ONLY SIGNING TEST HARNESS (tree-shaken in production builds)
const LazyDevPrivySigningTestPanel =
  !import.meta.env.PROD && IS_PRIVY_WALLET_TEST_MODE
    ? React.lazy(() => import("./components/DevPrivySigningTestPanel"))
    : null;

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
  const [isWalletPickerOpen, setIsWalletPickerOpen] = useState(false);

  const {
    user,
    authStage,
    isAuthenticated,
    isAuthModalOpen,
    openAuthModal,
    closeAuthModal,
    authenticatedFetch,
    effectiveAccount,
    switchSandboxPersona,
    requestExternalWalletChallenge,
    completeExternalWalletVerification,
  } = useAuth();

  const prevAuthRef = useRef(isAuthenticated);
  const prevStageRef = useRef(authStage);
  const prevUserIdRef = useRef<string | null>(user?.id ?? null);
  const agreementsRequestEpochRef = useRef(0);

  // Sync dark theme class on documentElement
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDark]);

  // Reset account-dependent UI state immediately on user change to prevent cross-account leaks
  useEffect(() => {
    const nextUserId = user?.id ?? null;
    if (prevUserIdRef.current !== nextUserId) {
      agreementsRequestEpochRef.current += 1;
      setAgreements([]);
      setSelectedAgreement(null);
      setWalletNotice(null);
      prevUserIdRef.current = nextUserId;
    }
  }, [user?.id]);

  // Enter workspace on sign in; return to landing page on sign out
  useEffect(() => {
    if (!prevAuthRef.current && isAuthenticated && !inApp) {
      setInApp(true);
      setActiveTab("workspace");
      setSelectedAgreement(null);
      if (isAuthModalOpen) {
        closeAuthModal();
      }
    } else if (prevAuthRef.current && !isAuthenticated) {
      setInApp(false);
      setAgreements([]);
      setSelectedAgreement(null);
      setWalletNotice(null);
    }
    prevAuthRef.current = isAuthenticated;
  }, [isAuthenticated, inApp, isAuthModalOpen, closeAuthModal]);

  // Surface recoverable sync_failed UI automatically (including after OAuth redirects)
  useEffect(() => {
    if (prevStageRef.current !== "sync_failed" && authStage === "sync_failed" && !isAuthModalOpen) {
      openAuthModal();
    }
    prevStageRef.current = authStage;
  }, [authStage, isAuthModalOpen, openAuthModal]);

  // Fetch agreements strictly for authenticated caller using centralized 401-safe helper
  const fetchAgreements = useCallback(async () => {
    const requestEpoch = ++agreementsRequestEpochRef.current;
    const expectedUserId = user?.id ?? null;

    if (!isAuthenticated || !expectedUserId) {
      setAgreements([]);
      return;
    }

    try {
      const res = await authenticatedFetch("/api/agreements");
      if (requestEpoch !== agreementsRequestEpochRef.current) {
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load agreements (${res.status})`);
      }
      const data: AgreementRecord[] = await res.json();
      if (requestEpoch !== agreementsRequestEpochRef.current) {
        return;
      }
      setAgreements(data);
      setSelectedAgreement((prev) =>
        prev ? data.find((a) => a.id === prev.id) || null : null
      );
    } catch (err: any) {
      if (requestEpoch !== agreementsRequestEpochRef.current) {
        return;
      }
      console.error("Error fetching agreements:", err);
      setWalletNotice(err.message || "Unable to load agreements.");
    }
  }, [isAuthenticated, user?.id, authenticatedFetch]);

  useEffect(() => {
    void fetchAgreements();
  }, [fetchAgreements, user?.stellarAddress, user?.wallets?.length]);

  const handleConnectRealWallet = () => {
    setWalletNotice(null);
    setIsWalletPickerOpen(true);
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
              userWallets={user?.wallets}
              onUpdateAgreement={handleAgreementSynced}
              onBack={() => setSelectedAgreement(null)}
            />
          ) : activeTab === "workspace" ? (
            <ConversationalWorkspace
              initialType={workspaceInitialType}
              currentUserAddress={effectiveAccount.address}
              currentUserName={effectiveAccount.displayName}
              availableWallets={user?.wallets}
              primaryWalletAddress={user?.primaryWalletAddress || user?.stellarAddress || null}
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
      <WalletPickerModal
        isOpen={isWalletPickerOpen}
        onClose={() => setIsWalletPickerOpen(false)}
        onRequestChallenge={requestExternalWalletChallenge}
        onCompleteVerification={completeExternalWalletVerification}
        onVerified={(linked) => {
          setWalletNotice(
            `Verified and linked ${formatStellarProviderName(linked.provider)} wallet (${linked.address.slice(0, 4)}...${linked.address.slice(-4)}).`
          );
        }}
      />
    </>
  );
}

function PrivyAuthWrapper({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user, getAccessToken, logout } = usePrivy();
  const { refreshUser } = useUser();
  const { isOpen: isPrivyModalOpen } = useModalStatus();
  const linkBridgeRef = useRef<PrivyLinkBridgeHandlers | null>(null);
  const sawPrivyModalOpenRef = useRef(false);
  const linkSettledRef = useRef(true);

  const { linkEmail, linkGoogle } = useLinkAccount({
    onSuccess: ({ user: linkedUser }) => {
      linkSettledRef.current = true;
      void linkBridgeRef.current?.onLinkSuccess(linkedUser as any);
    },
    onError: (error) => {
      linkSettledRef.current = true;
      linkBridgeRef.current?.onLinkError(error);
    },
  });

  useEffect(() => {
    if (isPrivyModalOpen) {
      sawPrivyModalOpenRef.current = true;
      return;
    }
    if (sawPrivyModalOpenRef.current && !linkSettledRef.current) {
      const timer = setTimeout(() => {
        if (!linkSettledRef.current) {
          linkSettledRef.current = true;
          sawPrivyModalOpenRef.current = false;
          linkBridgeRef.current?.onLinkCancel?.();
        }
      }, 180);
      return () => clearTimeout(timer);
    }
    sawPrivyModalOpenRef.current = false;
  }, [isPrivyModalOpen]);

  const wrappedLinkEmail = useCallback(() => {
    linkSettledRef.current = false;
    return linkEmail();
  }, [linkEmail]);

  const wrappedLinkGoogle = useCallback(() => {
    linkSettledRef.current = false;
    return linkGoogle();
  }, [linkGoogle]);

  return (
    <AuthProvider
      privyRuntime={{
        ready,
        authenticated,
        user: user as any,
        getAccessToken,
        refreshUser: () => refreshUser() as Promise<any>,
        linkEmail: wrappedLinkEmail,
        linkGoogle: wrappedLinkGoogle,
        logout,
        linkBridgeRef,
      }}
    >
      {children}
    </AuthProvider>
  );
}

export default function App() {
  if (IS_PRIVY_CONFIGURED && pollarPrivyAdapter) {
    return (
      <MotionConfig reducedMotion="user">
        <PrivyAdapterProvider adapter={pollarPrivyAdapter}>
          <PrivyAuthWrapper>
            <TrustFlowMain />
            {!import.meta.env.PROD &&
              IS_PRIVY_WALLET_TEST_MODE &&
              LazyDevPrivySigningTestPanel && (
                <React.Suspense fallback={null}>
                  <LazyDevPrivySigningTestPanel />
                </React.Suspense>
              )}
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
