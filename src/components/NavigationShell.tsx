import React, { useState } from "react";
import {
  Menu,
  X,
  ShieldCheck,
  Sun,
  Moon,
  Copy,
  Check,
  LogOut,
  UserCheck,
  RefreshCw,
  ExternalLink,
  ChevronDown,
  Lock,
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
  const [accountDrawerOpen, setAccountDrawerOpen] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);

  const {
    user,
    wallet,
    isAuthenticated,
    openAuthModal,
    logout,
    refreshBalance,
    isDemoSandbox,
    setIsDemoSandbox,
    selectedDemoPersona,
    setSelectedDemoPersona,
  } = useAuth();

  const navItems = [
    { id: "workspace", label: "Workspace" },
    { id: "all-agreements", label: "My payments" },
    { id: "active-review", label: "In progress" },
    { id: "completed", label: "Completed" },
  ];

  const handleCopyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B0E14] text-slate-900 dark:text-slate-100 flex flex-col transition-colors">
      {/* Demo Persona Notification Bar */}
      {isDemoSandbox && (
        <div className="bg-[#F5D03A] text-slate-950 px-4 py-1.5 text-xs font-bold border-b border-[#D4AF24]">
          <div className="flex items-center gap-2 max-w-7xl mx-auto w-full justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-slate-950" />
              <span>
                Testing persona: <strong>"{selectedDemoPersona.displayName}"</strong>
                {isAuthenticated ? " (Your real account is saved)" : ""}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setAccountDrawerOpen(true)}
                className="underline hover:text-slate-800 text-[11px] cursor-pointer"
              >
                Switch persona
              </button>
              {isAuthenticated && (
                <button
                  onClick={() => setIsDemoSandbox(false)}
                  className="px-2 py-0.5 rounded bg-slate-950 text-[#F5D03A] hover:bg-slate-800 text-[10px] font-extrabold cursor-pointer"
                >
                  Return to my account
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Top Header */}
      <header className="border-b border-slate-200 dark:border-slate-800/80 bg-white/95 dark:bg-[#0B0E14]/95 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          {/* Left: Mobile Toggle + Logo */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setDrawerOpen(!drawerOpen)}
              className="lg:hidden p-2 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Toggle navigation drawer"
            >
              {drawerOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            <button
              onClick={() => onTabChange("workspace")}
              className="flex items-center gap-2.5 text-left cursor-pointer"
            >
              <div className="w-8 h-8 rounded-lg bg-[#4A2574] flex items-center justify-center text-[#F5D03A] shadow-xs">
                <ShieldCheck className="w-5 h-5 text-[#F5D03A]" />
              </div>
              <span className="font-extrabold text-lg tracking-tight text-slate-950 dark:text-white font-display">
                TrustFlow
              </span>
            </button>
          </div>

          {/* Desktop Navigation Links */}
          <nav className="hidden lg:flex items-center gap-8 text-sm font-semibold text-slate-600 dark:text-slate-300">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`py-1 transition-colors cursor-pointer ${
                  activeTab === item.id
                    ? "text-slate-950 dark:text-[#F5D03A] font-bold border-b-2 border-slate-950 dark:border-[#F5D03A]"
                    : "hover:text-slate-950 dark:hover:text-white"
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Right Controls: Theme Toggle & Account Button */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={onToggleTheme}
              className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Toggle theme"
            >
              {isDark ? <Sun className="w-4 h-4 text-[#F5D03A]" /> : <Moon className="w-4 h-4" />}
            </button>

            {/* Account Drawer Trigger */}
            <button
              onClick={() => setAccountDrawerOpen(true)}
              className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-[#F5D03A] transition-colors flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200 cursor-pointer shadow-xs"
            >
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>{currentAccount.displayName}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Drawer */}
      {drawerOpen && (
        <div className="lg:hidden border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0E14] px-4 py-3 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                onTabChange(item.id);
                setDrawerOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
                activeTab === item.id
                  ? "bg-[#F5D03A]/20 text-slate-950 dark:text-[#F5D03A] font-bold"
                  : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              {item.label}
            </button>
          ))}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              onClick={() => {
                setAccountDrawerOpen(true);
                setDrawerOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200"
            >
              Account & Balance details →
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 py-8 w-full">
        {children}
      </main>

      {/* Account Drawer / Modal (Clean, Friendly & Non-technical) */}
      {accountDrawerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="relative w-full max-w-md bg-white dark:bg-[#121824] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden p-6 space-y-5">
            {/* Top Close button */}
            <button
              onClick={() => setAccountDrawerOpen(false)}
              className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Header */}
            <div>
              <span className="text-xs font-bold text-[#F5D03A] uppercase tracking-wider block mb-0.5">
                Account Information
              </span>
              <h2 className="text-xl font-black text-slate-950 dark:text-white font-display">
                {currentAccount.displayName}
              </h2>
              <p className="text-xs text-slate-500">
                {currentAccount.role} · Test network mode
              </p>
            </div>

            {/* Account Address Box */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
                <span>Account address</span>
                <button
                  onClick={() => handleCopyAddress(currentAccount.address)}
                  className="text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white flex items-center gap-1 cursor-pointer"
                >
                  {copiedAddress ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                      <span className="text-emerald-600 dark:text-emerald-400 text-[11px]">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span className="text-[11px]">Copy address</span>
                    </>
                  )}
                </button>
              </div>
              <div className="font-mono text-xs text-slate-900 dark:text-white break-all">
                {currentAccount.address}
              </div>
            </div>

            {/* Balances */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <span className="text-[11px] font-bold text-slate-500 uppercase">USDC Balance</span>
                <div className="text-xl font-black font-display text-slate-950 dark:text-white tabular-nums mt-1">
                  {currentAccount.balanceUSDC || "0.00"}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <span className="text-[11px] font-bold text-slate-500 uppercase">XLM Balance</span>
                <div className="text-xl font-black font-display text-slate-950 dark:text-white tabular-nums mt-1">
                  {currentAccount.balanceXLM || "10,000.00"}
                </div>
              </div>
            </div>

            {/* Persona Switcher for Testing (Alice / Bob / Charlie) */}
            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                Switch testing persona
              </span>
              <div className="space-y-1.5">
                {SIMULATED_PROFILES.map((p) => (
                  <button
                    key={p.address}
                    onClick={() => {
                      onAccountChange(p);
                      setAccountDrawerOpen(false);
                    }}
                    className={`w-full p-2.5 rounded-xl border text-left flex items-center justify-between text-xs transition-colors cursor-pointer ${
                      currentAccount.address === p.address
                        ? "border-[#F5D03A] bg-[#F5D03A]/10 font-bold text-slate-950 dark:text-white"
                        : "border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300"
                    }`}
                  >
                    <div>
                      <div className="font-bold">{p.displayName}</div>
                      <div className="text-[10px] text-slate-400 font-normal">
                        {p.role} · {formatAddress(p.address)}
                      </div>
                    </div>
                    {currentAccount.address === p.address && (
                      <Check className="w-4 h-4 text-[#F5D03A]" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Real Sign In / Log out */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
              {isAuthenticated ? (
                <button
                  onClick={() => {
                    logout();
                    setAccountDrawerOpen(false);
                  }}
                  className="text-xs font-bold text-red-600 dark:text-red-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign out
                </button>
              ) : (
                <button
                  onClick={() => {
                    setAccountDrawerOpen(false);
                    openAuthModal();
                  }}
                  className="text-xs font-bold text-[#4A2574] dark:text-[#F5D03A] hover:underline cursor-pointer"
                >
                  Sign in with email or Google
                </button>
              )}

              <button
                onClick={() => setAccountDrawerOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-950 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-lg transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
