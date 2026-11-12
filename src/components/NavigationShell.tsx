import React, { useState } from "react";
import {
  Menu,
  X,
  ShieldCheck,
  Sun,
  Moon,
  Wallet,
  UserCheck,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { WalletAccount, SIMULATED_PROFILES } from "../lib/stellar/wallet";
import { formatAddress } from "../lib/stellar/config";

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
  const [walletModalOpen, setWalletModalOpen] = useState(false);

  const navItems = [
    { id: "workspace", label: "Assistant Workspace" },
    { id: "all-agreements", label: "All Agreements" },
    { id: "pending-acceptance", label: "Pending Acceptance" },
    { id: "awaiting-funding", label: "Awaiting Funding" },
    { id: "active-review", label: "Active & Review" },
    { id: "completed", label: "Completed" },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0B0E14] text-slate-900 dark:text-slate-100 flex flex-col transition-colors">
      {/* Simulated Mode Banner if active */}
      {isSimulated && (
        <div className="bg-[#F5D03A] text-slate-950 px-4 py-1.5 text-xs font-bold flex items-center justify-between border-b border-[#D4AF24]">
          <div className="flex items-center gap-2 max-w-5xl mx-auto w-full justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-slate-950 animate-pulse" />
              <span>SIMULATED DEMO ENVIRONMENT: Testing with local persona "{currentAccount.displayName}".</span>
            </div>
            <button
              onClick={() => setWalletModalOpen(true)}
              className="underline text-slate-950 font-bold hover:text-slate-800 text-[11px] cursor-pointer"
            >
              Switch Role or Connect Freighter
            </button>
          </div>
        </div>
      )}

      {/* Top Bar Contract (Brand, Nav links, 1 Primary Action) */}
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

          {/* Right: Theme Toggle + Wallet/Persona Control */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={onToggleTheme}
              className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Toggle theme"
            >
              {isDark ? <Sun className="w-4 h-4 text-[#F5D03A]" /> : <Moon className="w-4 h-4 text-slate-700" />}
            </button>

            <button
              onClick={() => setWalletModalOpen(true)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-[#F5D03A] transition-all flex items-center gap-2 text-xs font-semibold shadow-xs cursor-pointer"
            >
              <span className="text-base leading-none">{currentAccount.avatar}</span>
              <div className="flex flex-col text-left">
                <span className="text-slate-900 dark:text-slate-100 font-bold leading-tight">
                  {currentAccount.displayName.split(" ")[0]}
                </span>
                <span className="text-[10px] text-slate-500 font-mono leading-tight">
                  {formatAddress(currentAccount.address)}
                </span>
              </div>
            </button>
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
                Active Role
              </span>
              <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400 font-mono text-[11px] mb-2">
                <span>{currentAccount.displayName}</span>
              </div>
              <button
                onClick={() => setWalletModalOpen(true)}
                className="w-full py-1 text-center text-[11px] font-bold text-slate-900 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-md transition-colors cursor-pointer"
              >
                Change Persona
              </button>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 min-w-0">{children}</main>
      </div>

      {/* Wallet / Persona Switcher Modal */}
      {walletModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
                <Wallet className="w-5 h-5 text-[#4A2574] dark:text-[#F5D03A]" />
                Wallet & Identity Selection
              </h3>
              <button
                onClick={() => setWalletModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
              Test multi-party escrow workflows effortlessly by switching between pre-configured simulated personas, or connect an authentic Freighter wallet.
            </p>

            <div className="space-y-2 mb-6">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                Simulated Testing Personas
              </div>
              {SIMULATED_PROFILES.map((profile) => (
                <button
                  key={profile.address}
                  onClick={() => {
                    onAccountChange(profile);
                    setWalletModalOpen(false);
                  }}
                  className={`w-full p-3 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                    currentAccount.address === profile.address
                      ? "border-[#4A2574] dark:border-[#F5D03A] bg-purple-50/50 dark:bg-amber-950/10 shadow-xs"
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
                        {formatAddress(profile.address)}
                      </div>
                    </div>
                  </div>
                  {currentAccount.address === profile.address && (
                    <CheckCircle2 className="w-4 h-4 text-[#4A2574] dark:text-[#F5D03A]" />
                  )}
                </button>
              ))}
            </div>

            <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                Real Stellar Testnet Wallet
              </div>
              <button
                onClick={() => {
                  onConnectRealWallet();
                  setWalletModalOpen(false);
                }}
                className="w-full py-2.5 px-4 rounded-xl font-bold text-xs bg-slate-900 text-white dark:bg-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm"
              >
                <Wallet className="w-4 h-4" />
                Connect Freighter Wallet (Testnet)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
