import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  Menu,
  X,
  ShieldCheck,
  Sun,
  Moon,
  Copy,
  Check,
  LogOut,
  RefreshCw,
  MessageSquare,
  Layers,
  Clock,
  CheckCircle2,
  User,
  Wallet,
  AlertCircle,
} from "lucide-react";
import { WalletAccount, SIMULATED_PROFILES } from "../lib/stellar/wallet";
import { formatAddress } from "../lib/stellar/config";
import { useAuth } from "../lib/auth/AuthContext";

interface NavigationShellProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onReturnHome: () => void;
  currentAccount: WalletAccount;
  onAccountChange: (account: WalletAccount) => Promise<void> | void;
  isSimulated: boolean;
  onConnectRealWallet: () => void;
  walletNotice?: string | null;
  onClearWalletNotice?: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
  children: React.ReactNode;
}

export const NavigationShell: React.FC<NavigationShellProps> = ({
  activeTab,
  onTabChange,
  onReturnHome,
  currentAccount,
  onAccountChange,
  onConnectRealWallet,
  walletNotice,
  onClearWalletNotice,
  isDark,
  onToggleTheme,
  children,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [refreshingBalance, setRefreshingBalance] = useState(false);
  const [switchingPersona, setSwitchingPersona] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);

  const {
    user,
    capabilities,
    isAuthenticated,
    openAuthModal,
    logout,
    refreshBalance,
    isDemoSandbox,
    selectedDemoPersona,
  } = useAuth();

  const navItems = [
    { id: "workspace", label: "Workspace", icon: MessageSquare },
    { id: "all-agreements", label: "My payments", icon: Layers },
    { id: "active-review", label: "In progress", icon: Clock },
    { id: "completed", label: "Completed", icon: CheckCircle2 },
  ];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setAccountModalOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuContainerRef.current &&
        !menuContainerRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  const handleCopyAddress = (addr: string) => {
    if (!addr) return;
    navigator.clipboard.writeText(addr);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  const handleRefreshBalances = async () => {
    setRefreshingBalance(true);
    try {
      await refreshBalance();
    } finally {
      setRefreshingBalance(false);
    }
  };

  const handleSelectNav = (tabId: string) => {
    onTabChange(tabId);
    setMenuOpen(false);
  };

  const handleOpenAccount = () => {
    setMenuOpen(false);
    setSwitchError(null);
    setAccountModalOpen(true);
  };

  const handleSwitchPersona = async (persona: WalletAccount) => {
    setSwitchingPersona(true);
    setSwitchError(null);
    try {
      await onAccountChange(persona);
    } catch (err: any) {
      setSwitchError(err.message || "Failed to switch testing role.");
    } finally {
      setSwitchingPersona(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--tf-canvas)] text-[var(--tf-ink)] flex flex-col transition-colors duration-200">
      {/* Slim Header */}
      <header className="sticky top-0 z-40 h-14 border-b border-[var(--tf-border)] bg-[var(--tf-canvas)]/85 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-full flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={onReturnHome}
            className="w-10 h-10 -ml-1 rounded-xl flex items-center justify-center group cursor-pointer focus:outline-none"
            aria-label="Return to TrustFlow home"
            title="Back to home"
          >
            <div className="w-8 h-8 rounded-lg bg-[#4A2574] flex items-center justify-center shadow-xs transition-transform duration-200 group-hover:scale-[1.04] group-active:scale-[0.96]">
              <ShieldCheck className="w-4 h-4 text-[#F5D03A]" />
            </div>
          </button>

          <div className="relative flex items-center gap-1" ref={menuContainerRef}>
            <button
              type="button"
              onClick={onToggleTheme}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/70 transition-colors cursor-pointer"
              aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
            >
              {isDark ? (
                <Sun className="w-4 h-4 text-[#F5D03A]" />
              ) : (
                <Moon className="w-4 h-4 text-slate-700" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
                menuOpen
                  ? "bg-slate-200/80 dark:bg-slate-800 text-slate-950 dark:text-white"
                  : "text-slate-700 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800/70"
              }`}
              aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={menuOpen}
            >
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            {/* Desktop Refined Dropdown Panel */}
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={shouldReduceMotion ? false : { opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={shouldReduceMotion ? undefined : { opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="hidden sm:block absolute right-0 top-12 w-72 rounded-2xl bg-[var(--tf-surface)]/95 backdrop-blur-md border border-[var(--tf-border)] shadow-xl p-2 z-50"
                >
                  <div className="space-y-0.5">
                    {navItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = activeTab === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleSelectNav(item.id)}
                          className={`w-full flex items-center justify-between gap-3 px-3 min-h-[40px] rounded-xl text-sm transition-colors cursor-pointer ${
                            isActive
                              ? "bg-slate-100 dark:bg-slate-800/90 text-slate-950 dark:text-white font-semibold"
                              : "text-slate-600 dark:text-slate-300 hover:bg-slate-100/70 dark:hover:bg-slate-800/50 hover:text-slate-950 dark:hover:text-white font-medium"
                          }`}
                        >
                          <span className="flex items-center gap-3 min-w-0">
                            <Icon
                              className={`w-4 h-4 shrink-0 ${
                                isActive
                                  ? "text-[#4A2574] dark:text-[#F5D03A]"
                                  : "text-slate-400"
                              }`}
                            />
                            <span className="truncate">{item.label}</span>
                          </span>
                          {isActive && (
                            <span className="w-1.5 h-1.5 rounded-full bg-[#4A2574] dark:bg-[#F5D03A] shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <div className="my-2 border-t border-[var(--tf-border)]" />

                  <button
                    type="button"
                    onClick={handleOpenAccount}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100/70 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      <User className="w-4 h-4 shrink-0 text-slate-400" />
                      <span className="truncate">Account and balance details</span>
                    </span>
                  </button>

                  {isDemoSandbox && (
                    <div className="mt-1.5 px-3 py-2 rounded-xl bg-amber-500/10 text-[11px] text-amber-800 dark:text-amber-300 flex items-center justify-between">
                      <span className="truncate">
                        Dev Sandbox: {selectedDemoPersona.displayName.split(" ")[0]}
                      </span>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* Mobile Slide-In Drawer */}
      <AnimatePresence>
        {menuOpen && (
          <div className="sm:hidden fixed inset-0 z-50">
            <motion.div
              initial={shouldReduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={shouldReduceMotion ? undefined : { opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setMenuOpen(false)}
              className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs"
            />
            <motion.aside
              initial={shouldReduceMotion ? false : { x: "100%" }}
              animate={{ x: 0 }}
              exit={shouldReduceMotion ? undefined : { x: "100%" }}
              transition={{ type: "spring", stiffness: 360, damping: 34 }}
              className="fixed inset-y-0 right-0 w-72 max-w-[85vw] bg-[var(--tf-surface)]/95 backdrop-blur-md border-l border-[var(--tf-border)] shadow-2xl flex flex-col p-4"
            >
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-[var(--tf-border)]">
                <span className="font-display font-semibold text-sm text-slate-900 dark:text-white">
                  Menu
                </span>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  aria-label="Close navigation menu"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <nav className="space-y-1 flex-1">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelectNav(item.id)}
                      className={`w-full flex items-center justify-between gap-3 px-3.5 min-h-[44px] rounded-xl text-sm transition-colors cursor-pointer ${
                        isActive
                          ? "bg-slate-100 dark:bg-slate-800 text-slate-950 dark:text-white font-semibold"
                          : "text-slate-600 dark:text-slate-300 hover:bg-slate-100/70 dark:hover:bg-slate-800/50 font-medium"
                      }`}
                    >
                      <span className="flex items-center gap-3 min-w-0">
                        <Icon
                          className={`w-4 h-4 shrink-0 ${
                            isActive
                              ? "text-[#4A2574] dark:text-[#F5D03A]"
                              : "text-slate-400"
                          }`}
                        />
                        <span className="truncate">{item.label}</span>
                      </span>
                      {isActive && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[#4A2574] dark:bg-[#F5D03A] shrink-0" />
                      )}
                    </button>
                  );
                })}

                <div className="my-3 border-t border-[var(--tf-border)]" />

                <button
                  type="button"
                  onClick={handleOpenAccount}
                  className="w-full flex items-center gap-3 px-3.5 min-h-[44px] rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100/70 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                >
                  <User className="w-4 h-4 shrink-0 text-slate-400" />
                  <span className="truncate">Account and balance details</span>
                </button>
              </nav>

              {isDemoSandbox && (
                <div className="pt-3 border-t border-[var(--tf-border)] text-xs text-amber-800 dark:text-amber-300 flex items-center justify-between">
                  <span className="truncate">
                    Dev Sandbox: {selectedDemoPersona.displayName.split(" ")[0]}
                  </span>
                </div>
              )}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <main className="flex-1 max-w-5xl mx-auto px-4 sm:px-6 py-5 sm:py-8 w-full">
        {children}
      </main>

      {/* Account & Balance Details Modal */}
      <AnimatePresence>
        {accountModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={shouldReduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={shouldReduceMotion ? undefined : { opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setAccountModalOpen(false)}
              className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
            />

            <motion.div
              initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={shouldReduceMotion ? undefined : { opacity: 0, scale: 0.97, y: 8 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="relative w-full max-w-md max-h-[90dvh] overflow-y-auto bg-[var(--tf-surface)]/95 backdrop-blur-md rounded-2xl border border-[var(--tf-border)] shadow-2xl p-6 space-y-5 z-10"
            >
              <button
                type="button"
                onClick={() => setAccountModalOpen(false)}
                className="absolute top-4 right-4 w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                aria-label="Close account details"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="pr-8">
                <div className="text-xs font-medium text-[#4A2574] dark:text-[#F5D03A] mb-1">
                  {isDemoSandbox ? "Development Sandbox Session" : "Account and balance details"}
                </div>
                <h2 className="text-xl font-display font-bold text-slate-950 dark:text-white">
                  {currentAccount.displayName}
                </h2>
                <p className="text-xs text-[var(--tf-muted)] mt-0.5">
                  {user?.email ? `${user.email} · ` : ""}
                  {user?.walletCustody === "none" ? "No wallet linked" : "Stellar Testnet"}
                </p>
              </div>

              {(walletNotice || switchError) && (
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-xs text-amber-900 dark:text-amber-200 flex items-start justify-between gap-2">
                  <span className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{switchError || walletNotice}</span>
                  </span>
                  {onClearWalletNotice && !switchError && (
                    <button
                      type="button"
                      onClick={onClearWalletNotice}
                      className="text-xs opacity-70 hover:opacity-100 cursor-pointer"
                      aria-label="Dismiss notice"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}

              {/* Stellar Account Address + Copy */}
              <div className="p-3.5 rounded-xl bg-[var(--tf-surface-subtle)] border border-[var(--tf-border)] space-y-1.5">
                <div className="flex items-center justify-between text-xs text-[var(--tf-muted)]">
                  <span>Linked wallet address</span>
                  {currentAccount.address && (
                    <button
                      type="button"
                      onClick={() => handleCopyAddress(currentAccount.address)}
                      className="inline-flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white cursor-pointer"
                    >
                      {copiedAddress ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                          <span className="text-emerald-600 dark:text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy address</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
                {currentAccount.address ? (
                  <div className="font-mono text-xs text-slate-900 dark:text-slate-100 break-all leading-relaxed">
                    {currentAccount.address}
                  </div>
                ) : (
                  <div className="text-xs text-[var(--tf-muted)]">
                    No Stellar wallet linked yet. Connect Freighter below to bind a wallet address.
                  </div>
                )}
              </div>

              {/* Balances */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--tf-muted)]">
                    Available balances
                  </span>
                  {isAuthenticated && currentAccount.address && (
                    <button
                      type="button"
                      onClick={handleRefreshBalances}
                      disabled={refreshingBalance}
                      className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw
                        className={`w-3 h-3 ${refreshingBalance ? "animate-spin" : ""}`}
                      />
                      <span>Refresh</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3.5 rounded-xl bg-[var(--tf-surface-subtle)] border border-[var(--tf-border)]">
                    <span className="text-xs text-[var(--tf-muted)]">USDC</span>
                    <div className="text-xl font-display font-bold text-slate-950 dark:text-white tabular-nums mt-0.5">
                      {currentAccount.balanceUSDC || "0.00"}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[var(--tf-surface-subtle)] border border-[var(--tf-border)]">
                    <span className="text-xs text-[var(--tf-muted)]">XLM</span>
                    <div className="text-xl font-display font-bold text-slate-950 dark:text-white tabular-nums mt-0.5">
                      {currentAccount.balanceXLM || "0.00"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Development Sandbox Persona Switcher (explicitly gated) */}
              {capabilities.devSandboxEnabled && isDemoSandbox && (
                <div className="space-y-2 pt-3 border-t border-[var(--tf-border)]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[var(--tf-muted)]">
                      Switch sandbox testing role
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {SIMULATED_PROFILES.map((p) => {
                      const selected = currentAccount.address === p.address;
                      return (
                        <button
                          key={p.address}
                          type="button"
                          disabled={switchingPersona}
                          onClick={() => handleSwitchPersona(p)}
                          className={`w-full px-3 py-2.5 rounded-xl border text-left flex items-center justify-between text-xs transition-colors cursor-pointer disabled:opacity-50 ${
                            selected
                              ? "border-[#F5D03A] bg-[#F5D03A]/10 text-slate-950 dark:text-white font-semibold"
                              : "border-[var(--tf-border)] text-slate-600 dark:text-slate-300 hover:bg-[var(--tf-surface-subtle)]"
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="truncate">{p.displayName}</div>
                            <div className="text-[11px] text-[var(--tf-muted)] font-normal mt-0.5">
                              {p.role.toLowerCase()} · {formatAddress(p.address)}
                            </div>
                          </div>
                          {selected && <Check className="w-4 h-4 text-[#F5D03A] shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Account Actions */}
              <div className="pt-3 border-t border-[var(--tf-border)] flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {isAuthenticated ? (
                    <button
                      type="button"
                      onClick={() => {
                        logout();
                        setAccountModalOpen(false);
                      }}
                      className="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign out</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setAccountModalOpen(false);
                        openAuthModal();
                      }}
                      className="text-xs font-semibold text-[#4A2574] dark:text-[#F5D03A] hover:underline cursor-pointer"
                    >
                      Sign in
                    </button>
                  )}

                  {!isDemoSandbox && (
                    <button
                      type="button"
                      onClick={onConnectRealWallet}
                      className="text-xs font-medium text-[var(--tf-muted)] hover:text-slate-900 dark:hover:text-white inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Wallet className="w-3.5 h-3.5" />
                      <span>Connect Freighter</span>
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setAccountModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-950 bg-[#F5D03A] hover:bg-[#E7BF24] rounded-xl transition-colors cursor-pointer"
                >
                  Done
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
