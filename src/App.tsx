import React, { useState, useEffect } from "react";
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

function TrustFlowMain() {
  const [inApp, setInApp] = useState(false);
  const [activeTab, setActiveTab] = useState("workspace");
  const [isDark, setIsDark] = useState(true);
  const [agreements, setAgreements] = useState<AgreementRecord[]>([]);
  const [selectedAgreement, setSelectedAgreement] =
    useState<AgreementRecord | null>(null);
  const [workspaceInitialType, setWorkspaceInitialType] =
    useState<TransactionType>("WORK");

  const {
    effectiveAccount,
    setIsDemoSandbox,
    setSelectedDemoPersona,
  } = useAuth();

  // Sync dark theme class on documentElement
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDark]);

  // Fetch agreements from Express server backend
  const fetchAgreements = async () => {
    try {
      const res = await fetch("/api/agreements");
      if (res.ok) {
        const data = await res.json();
        setAgreements(data);
      }
    } catch (err) {
      console.error("Error fetching agreements:", err);
    }
  };

  useEffect(() => {
    fetchAgreements();
  }, []);

  // Connect authentic Freighter wallet (fallback)
  const handleConnectRealWallet = async () => {
    try {
      const realAccount = await connectFreighterWallet();
      if (realAccount) {
        setSelectedDemoPersona(realAccount);
        setIsDemoSandbox(false);
      }
    } catch (err: any) {
      alert(err.message || "Failed to connect Freighter wallet.");
    }
  };

  // Switch persona (e.g. Alice Payer, Bob Contractor, Charlie Approver)
  const handleAccountChange = (account: WalletAccount) => {
    setSelectedDemoPersona(account);
    setIsDemoSandbox(true);
  };

  // Update agreement record in state and server
  const handleUpdateAgreement = async (updated: AgreementRecord) => {
    try {
      await fetch("/api/agreements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      setSelectedAgreement(updated);
      setAgreements((prev) =>
        prev.map((a) => (a.id === updated.id ? updated : a))
      );
    } catch (err) {
      console.error("Failed to persist agreement update:", err);
    }
  };

  // Launch app from landing page
  const handleLaunchApp = (type?: TransactionType) => {
    if (type) {
      setWorkspaceInitialType(type);
    }
    setInApp(true);
    setActiveTab("workspace");
  };

  // If visitor is on public landing page
  if (!inApp) {
    return <LandingPage onLaunch={handleLaunchApp} />;
  }

  return (
    <NavigationShell
      activeTab={activeTab}
      onTabChange={(tab) => {
        setSelectedAgreement(null);
        setActiveTab(tab);
      }}
      currentAccount={effectiveAccount}
      onAccountChange={handleAccountChange}
      isSimulated={effectiveAccount.isSimulated}
      onConnectRealWallet={handleConnectRealWallet}
      isDark={isDark}
      onToggleTheme={() => setIsDark(!isDark)}
    >
      {selectedAgreement ? (
        <AgreementDetailRoom
          agreement={selectedAgreement}
          currentAccount={effectiveAccount}
          onUpdateAgreement={handleUpdateAgreement}
          onBack={() => setSelectedAgreement(null)}
        />
      ) : activeTab === "workspace" ? (
        <ConversationalWorkspace
          initialType={workspaceInitialType}
          currentUserAddress={effectiveAccount.address}
          onAgreementCreated={(newAgr) => {
            setAgreements((prev) => [newAgr, ...prev]);
            setSelectedAgreement(newAgr);
          }}
        />
      ) : (
        <AgreementListView
          agreements={agreements}
          activeFilter={activeTab}
          onSelectAgreement={(agr) => setSelectedAgreement(agr)}
          onCreateNew={() => {
            setSelectedAgreement(null);
            setActiveTab("workspace");
          }}
        />
      )}
    </NavigationShell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <TrustFlowMain />
      <AuthModal />
    </AuthProvider>
  );
}
