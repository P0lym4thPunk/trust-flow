import React, { useState } from "react";
import {
  Menu,
  X,
  ShieldCheck,
  Sun,
  Moon,
  Wallet,
  ExternalLink,
  Copy,
  Check,
  LogOut,
  Sparkles,
  RefreshCw,
  UserCheck,
  CheckCircle2,
} from "lucide-react";
import { WalletAccount, SIMULATED_PROFILES } from "../lib/stellar/wallet";
import { formatAddress } from "../lib/stellar/config";
import { useAuth } from "../lib/auth/AuthContext";

interface NavigationShellProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  currentAccount: WalletAccount;
  onAccountChange: (account: WalletAccount) => void;
  isSimulated: boolean;
  onConnectRealWallet: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
  children: React.ReactNode;
}

export const NavigationShell: React.FC<NavigationShellProps> = ({
  activeTab,
  onTabChange,
  currentAccount,
  onAccountChange,
  isSimulated,
  onConnectRealWallet,
  isDark,
  onToggleTheme,
  children,
}) => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [signingLoading, setSigningLoading] = useState(false);
  const [sigResult, setSigResult] = useState<{ txHash: string; status: string } | null>(null);

  const {
    user,
    wallet,
    isAuthenticated,
    openAuthModal,
    logout,
    refreshBalance,
    signTestTransaction,
    isDemoSandbox,
    setIsDemoSandbox,
    selectedDemoPersona,
    setSelectedDemoPersona,
  } = useAuth();

  const navItems = [
    { id: "workspace", label: "Assistant Workspace" },
    { id: "all-agreements", label: "All Agreements" },
    { id: "pending-acceptance", label: "Pending Acceptance" },
    { id: "awaiting-funding", label: "Awaiting Funding" },
    { id: "active-review", label: "Active & Review" },
    { id: "completed", label: "Completed" },
  ];

  const handleCopyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0B0E14] text-slate-900 dark:text-slate-100 flex flex-col transition-colors">
      {/* Demo Sandbox Alert Banner */}
      {isDemoSandbox && (
        <div className="bg-[#F5D03A] text-slate-950 px-4 py-1.5 text-xs font-bold border-b border-[#D4AF24]">
          <div className="flex items-center gap-2 max-w-7xl mx-auto w-full justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-slate-950 animate-pulse" />
              <span>
                DEMO SANDBOX ACTIVE: Testing multi-party workflow as simulated persona{" "}
                <strong>"{selectedDemoPersona.displayName}"</strong>.
                {isAuthenticated && " (Your real account remains isolated)"}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setProfileModalOpen(true)}
                className="underline hover:text-slate-800 text-[11px] cursor-pointer"
              >
                Switch Persona
              </button>
              {isAuthenticated && (
                <button
                  onClick={() => setIsDemoSandbox(false)}
                  className="px-2 py-0.5 rounded bg-slate-950 text-[#F5D03A] hover:bg-slate-800 text-[10px] font-extrabold cursor-pointer"
                >
                  Return to Real Account
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Top Bar Header */}
      <header className="border-b border-slate-200 dark:border-slate-800/80 bg-white/95 dark:bg-[#0B0E14]/95 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          {/* Left: Mobile Drawer Button + Brand Identity */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setDrawerOpen(!drawerOpen)}
              className="p-2 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Toggle navigation drawer"
            >
              {drawerOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            <a href="/" className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#4A2574] to-[#F5D03A] flex items-center justify-center text-white shadow-xs">
                <ShieldCheck className="w-4 h-4 text-white" />
              </div>
              <span className="font-extrabold text-lg tracking-tight text-slate-900 dark:text-white">
                TrustFlow
              </span>
            </a>
          </div>

          {/* Middle: Desktop Nav Links */}
          <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300">
            {navItems.slice(0, 4).map((item) => (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`whitespace-nowrap transition-colors cursor-pointer py-1 ${
                  activeTab === item.id
                    ? "text-[#4A2574] dark:text-[#F5D03A] font-bold border-b-2 border-[#4A2574] dark:border-[#F5D03A]"
                    : "hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Right: Theme Toggle + Wallet / Identity Control */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={onToggleTheme}
              className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Toggle theme"
            >
              {isDark ? <Sun className="w-4 h-4 text-[#F5D03A]" /> : <Moon className="w-4 h-4 text-slate-700" />}
            </button>

            {isAuthenticated && !isDemoSandbox ? (
              /* Real Authenticated Embedded Wallet Button */
              <button
                onClick={() => setProfileModalOpen(true)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-[#F5D03A] transition-all flex items-center gap-2 text-xs font-semibold shadow-xs cursor-pointer"
              >
                <span className="text-base leading-none">{user?.avatar || "✨"}</span>
                <div className="flex flex-col text-left">
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-900 dark:text-slate-100 font-bold leading-tight">
                      {user?.displayName}
                    </span>
                    <span className="text-[9px] px-1 py-0.2 rounded font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                      Embedded
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono leading-tight">
                    {formatAddress(wallet?.address || "")} • {wallet?.balanceXLM || "0.00"} XLM
                  </span>
                </div>
              </button>
            ) : isDemoSandbox ? (
              /* Demo Sandbox Active Button */
              <button
                onClick={() => setProfileModalOpen(true)}
                className="px-3 py-1.5 rounded-lg border border-[#F5D03A]/60 bg-[#F5D03A]/10 hover:border-[#F5D03A] transition-all flex items-center gap-2 text-xs font-semibold shadow-xs cursor-pointer"
              >
                <span className="text-base leading-none">{selectedDemoPersona.avatar}</span>
                <div className="flex flex-col text-left">
                  <span className="text-slate-900 dark:text-slate-100 font-bold leading-tight">
                    {selectedDemoPersona.displayName.split(" ")[0]} (Demo)
                  </span>
                  <span className="text-[10px] text-amber-600 dark:text-amber-400 font-mono leading-tight">
                    {formatAddress(selectedDemoPersona.address)}
                  </span>
                </div>
              </button>
            ) : (
              /* Not Authenticated -> Sign In Action */
              <button
                onClick={openAuthModal}
                className="px-3.5 py-1.5 rounded-lg bg-[#4A2574] hover:bg-[#361A53] text-white text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#F5D03A]" />
                <span>Sign In / Onboard</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Container with Collapsible Navigation Drawer */}
      <div className="flex-1 flex max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 gap-6 relative">
        {/* Navigation Drawer (Desktop Sidebar + Mobile Overlay) */}
        {drawerOpen && (
          <div
            className="fixed inset-0 bg-slate-950/40 z-40 lg:hidden backdrop-blur-xs"
            onClick={() => setDrawerOpen(false)}
          />
        )}

        <aside
          className={`fixed lg:static top-16 bottom-0 left-0 z-50 w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col p-4 transition-transform duration-200 lg:translate-x-0 ${
            drawerOpen ? "translate-x-0" : "-translate-x-full lg:block"
          }`}
        >
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider px-3 mb-2">
            Navigation
          </div>

          <div className="space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  onTabChange(item.id);
                  setDrawerOpen(false);
                }}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center justify-between cursor-pointer ${
                  activeTab === item.id
                    ? "bg-[#4A2574]/10 dark:bg-[#F5D03A]/10 text-[#4A2574] dark:text-[#F5D03A] font-bold"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                <span>{item.label}</span>
              </button>
            ))}
          </div>

          <div className="mt-auto pt-4 border-t border-slate-200 dark:border-slate-800">
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/50 border border-slate-200/60 dark:border-slate-800/60 text-xs">
              <span className="font-bold block text-slate-800 dark:text-slate-200 mb-1">
                Active Identity
              </span>
              <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400 font-mono text-[11px] mb-2">
                <span>{currentAccount.displayName}</span>
              </div>
              <button
                onClick={() => setProfileModalOpen(true)}
                className="w-full py-1 text-center text-[11px] font-bold text-slate-900 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-md transition-colors cursor-pointer"
              >
                Manage Wallet & Personas
              </button>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 min-w-0">{children}</main>
      </div>

      {/* Account & Wallet Details / Persona Switcher Modal */}
      {profileModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#121824] border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4 border-b border-slate-100 dark:border-slate-800/80 pb-3">
              <h3 className="font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
                <Wallet className="w-5 h-5 text-[#4A2574] dark:text-[#F5D03A]" />
                Account & Stellar Wallet
              </h3>
              <button
                onClick={() => setProfileModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Section 1: Real Authenticated Embedded Wallet */}
            {isAuthenticated ? (
              <div className="mb-6 p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl">{user?.avatar || "✨"}</span>
                    <div>
                      <div className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <span>{user?.displayName}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-emerald-500 text-slate-950">
                          Active Embedded Wallet
                        </span>
                      </div>
                      <div className="text-xs text-slate-500">{user?.email}</div>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      logout();
                      setProfileModalOpen(false);
                    }}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                    title="Sign Out"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>

                {/* Stellar Address Card */}
                <div className="p-3 bg-white dark:bg-slate-900/80 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500 font-medium">Stellar Testnet Address:</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCopyAddress(wallet?.address || "")}
                        className="text-[11px] font-bold text-[#4A2574] dark:text-[#F5D03A] flex items-center gap-1 cursor-pointer hover:underline"
                      >
                        {copiedAddress ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                            <span className="text-emerald-500">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                      <a
                        href={`https://stellar.expert/explorer/testnet/account/${wallet?.address}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                        title="View on Stellar Expert"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                  <div className="font-mono text-xs text-slate-800 dark:text-slate-200 break-all select-all">
                    {wallet?.address}
                  </div>

                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                    <span className="text-slate-500 font-medium">Testnet Balance:</span>
                    <div className="flex items-center gap-2">
                      <span className="font-bold tabular-nums text-slate-900 dark:text-white">
                        {wallet?.balanceXLM} XLM
                      </span>
                      <button
                        onClick={() => refreshBalance()}
                        className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                        title="Refresh balance from Horizon"
                      >
                        <RefreshCw className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Testnet User Signature Authorization Demo */}
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                    <button
                      type="button"
                      disabled={signingLoading}
                      onClick={async () => {
                        setSigningLoading(true);
                        setSigResult(null);
                        try {
                          const res = await signTestTransaction();
                          setSigResult({ txHash: res.txHash, status: res.status });
                        } catch (err: any) {
                          alert(`Signing failed: ${err.message}`);
                        } finally {
                          setSigningLoading(false);
                        }
                      }}
                      className="w-full py-1.5 px-3 rounded-lg border border-slate-300 dark:border-slate-700 hover:border-[#F5D03A] bg-slate-50 dark:bg-slate-800 text-[11px] font-bold text-slate-700 dark:text-slate-200 flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                    >
                      {signingLoading ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#D4AF24]" />
                          <span>Authorizing Signature...</span>
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-3.5 h-3.5 text-[#D4AF24] dark:text-[#F5D03A]" />
                          <span>Test Authorize Wallet Signature</span>
                        </>
                      )}
                    </button>

                    {sigResult && (
                      <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-[10px] space-y-1">
                        <div className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300 font-bold">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Signature Authorized via Embedded Wallet</span>
                        </div>
                        <div className="font-mono text-slate-600 dark:text-slate-400 truncate">
                          Tx Hash: {sigResult.txHash}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {isDemoSandbox && (
                  <button
                    onClick={() => {
                      setIsDemoSandbox(false);
                      setProfileModalOpen(false);
                    }}
                    className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-colors cursor-pointer"
                  >
                    Switch Active Context to Real Embedded Wallet
                  </button>
                )}
              </div>
            ) : (
              <div className="mb-6 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 text-center space-y-2">
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  You are currently operating in guest / sandbox mode without a real account.
                </p>
                <button
                  onClick={() => {
                    setProfileModalOpen(false);
                    openAuthModal();
                  }}
                  className="py-2 px-4 rounded-lg bg-[#4A2574] hover:bg-[#361A53] text-white font-bold text-xs transition-all cursor-pointer shadow-xs inline-flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#F5D03A]" />
                  <span>Create Account & Provision Embedded Wallet</span>
                </button>
              </div>
            )}

            {/* Section 2: Demo Sandbox Personas */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Demo Sandbox Personas
                </span>
                <span className="text-[10px] text-slate-400">Multi-Role Testing Sandbox</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Switch into simulated persona mode to test counterparty acceptance, funding, and approvals without needing multiple devices.
              </p>

              <div className="space-y-2">
                {SIMULATED_PROFILES.map((profile) => {
                  const isSelected = isDemoSandbox && selectedDemoPersona.address === profile.address;
                  return (
                    <button
                      key={profile.address}
                      onClick={() => {
                        setSelectedDemoPersona(profile);
                        setIsDemoSandbox(true);
                        setProfileModalOpen(false);
                      }}
                      className={`w-full p-3 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                        isSelected
                          ? "border-[#F5D03A] bg-[#F5D03A]/10 shadow-xs"
                          : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{profile.avatar}</span>
                        <div>
                          <div className="text-xs font-bold text-slate-900 dark:text-white">
                            {profile.displayName}
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono">
                            {formatAddress(profile.address)} • {profile.balanceXLM} XLM
                          </div>
                        </div>
                      </div>
                      {isSelected && (
                        <CheckCircle2 className="w-4 h-4 text-[#4A2574] dark:text-[#F5D03A]" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Section 3: External Wallet Optional Fallback */}
            <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => {
                  onConnectRealWallet();
                  setProfileModalOpen(false);
                }}
                className="w-full py-2 px-3 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-400 flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                <Wallet className="w-3.5 h-3.5" />
                <span>External Wallet Adapter (Freighter Extension)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
