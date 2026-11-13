import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  ShieldCheck,
  ArrowRight,
  Sun,
  Moon,
  Menu,
  X,
  Check,
  Clock,
  ArrowDown,
  ChevronDown,
  Lock,
} from "lucide-react";

interface LandingProps {
  isDark: boolean;
  onToggleTheme: () => void;
  onGetStarted: () => void;
  onOpenApp: () => void;
}

const PREVIEW_STAGES = [
  {
    id: "agreed",
    stepIndex: 0,
    badge: "Agreement accepted",
    detail: "Scope, 500.00 USDC, and deadline confirmed",
    progress: 25,
    tone: "amber" as const,
  },
  {
    id: "secured",
    stepIndex: 1,
    badge: "Funds secured",
    detail: "Client funded the agreement before work begins",
    progress: 50,
    tone: "purple" as const,
  },
  {
    id: "submitted",
    stepIndex: 2,
    badge: "Work submitted",
    detail: "Freelancer shared deliverables for review",
    progress: 75,
    tone: "purple" as const,
  },
  {
    id: "released",
    stepIndex: 3,
    badge: "Payment released",
    detail: "Client approved delivery and funds moved",
    progress: 100,
    tone: "emerald" as const,
  },
];

const TRUST_TOPICS = [
  {
    id: "fee",
    title: "Platform fee (1%)",
    body: "TrustFlow charges a 1% platform fee, borne by the client or person funding the agreement—not automatically whoever drafts it.",
  },
  {
    id: "disputes",
    title: "Disputes & review",
    body: "Disagreements are intended to follow the agreed dispute process with an independent human resolver accepted by both parties before funding. AI can help organize agreement details and evidence, but it never independently decides disputes or authorizes financial releases. Note: independent human dispute resolution is part of the product roadmap and is not yet live in this preview.",
  },
  {
    id: "deadlines",
    title: "Deadlines & timeouts",
    body: "Agreements can record expected delivery and review dates. Funds never move automatically simply because a countdown reaches zero.",
  },
  {
    id: "wallet",
    title: "Wallet access",
    body: "You can sign in with email or Google, or connect a supported Stellar wallet without handling raw technical keys in the main interface.",
  },
  {
    id: "withdrawals",
    title: "Withdrawals & NGN bank accounts",
    body: "Direct withdrawals to Nigerian bank accounts are not yet available. Users currently interact with their supported Stellar Testnet wallet functionality directly.",
  },
  {
    id: "testnet",
    title: "Early access & Testnet",
    body: "TrustFlow is currently running on Stellar Testnet with test funds only. No real-world money is moved in this testing environment.",
  },
];

export const LandingPage: React.FC<LandingProps> = ({
  isDark,
  onToggleTheme,
  onGetStarted,
  onOpenApp,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const [stageIndex, setStageIndex] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openTopicId, setOpenTopicId] = useState<string | null>("fee");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (shouldReduceMotion) {
      setStageIndex(3);
      return;
    }
    const timer = setInterval(() => {
      setStageIndex((prev) => (prev + 1) % PREVIEW_STAGES.length);
    }, 2900);
    return () => clearInterval(timer);
  }, [shouldReduceMotion]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [menuOpen]);

  const currentStage = PREVIEW_STAGES[stageIndex];

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: shouldReduceMotion ? "auto" : "smooth" });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[var(--tf-canvas)] text-[var(--tf-ink)] transition-colors duration-200">
      {/* Minimal Header: Logo mark left, Theme toggle + Menu toggle right */}
      <header className="sticky top-0 z-40 h-14 border-b border-[var(--tf-border)] bg-[var(--tf-canvas)]/85 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-full flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={scrollToTop}
            className="w-10 h-10 -ml-1 rounded-xl flex items-center justify-center group cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4A2574] dark:focus-visible:outline-[#F5D03A]"
            aria-label="TrustFlow home"
          >
            <div className="w-8 h-8 rounded-lg bg-[#4A2574] flex items-center justify-center shadow-xs transition-transform duration-200 group-hover:scale-[1.03] group-active:scale-[0.97]">
              <ShieldCheck className="w-4 h-4 text-[#F5D03A]" />
            </div>
          </button>

          <div className="relative flex items-center gap-1" ref={menuRef}>
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
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
            >
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={shouldReduceMotion ? false : { opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={shouldReduceMotion ? undefined : { opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute right-0 top-12 w-56 rounded-2xl bg-[var(--tf-surface)] border border-[var(--tf-border)] shadow-xl p-1.5 z-50"
                >
                  <a
                    href="#how-it-works"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center px-3 min-h-[40px] rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-[var(--tf-surface-subtle)] transition-colors"
                  >
                    How it works
                  </a>
                  <a
                    href="#trust-transparency"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center px-3 min-h-[40px] rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-[var(--tf-surface-subtle)] transition-colors"
                  >
                    Trust & transparency
                  </a>
                  <div className="my-1 border-t border-[var(--tf-border)]" />
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenApp();
                    }}
                    className="w-full text-left flex items-center px-3 min-h-[40px] rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-[var(--tf-surface-subtle)] transition-colors cursor-pointer"
                  >
                    Open workspace
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="max-w-5xl mx-auto px-4 sm:px-6 pt-10 pb-12 sm:pt-16 sm:pb-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            {/* Hero Copy */}
            <motion.div
              className="lg:col-span-7 space-y-5"
              initial={shouldReduceMotion ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            >
              <p className="text-sm font-medium text-[#4A2574] dark:text-[#F5D03A]">
                Protected payments for freelance work
              </p>

              <h1 className="font-display font-bold tracking-tight text-slate-950 dark:text-white leading-[1.08] text-balance text-[clamp(2rem,4.4vw,3.25rem)]">
                Get paid for your work.{" "}
                <span className="trustflow-underline">
                  Without the payment stress.
                </span>
              </h1>

              <p className="text-base sm:text-lg text-[var(--tf-muted)] leading-relaxed max-w-xl">
                TrustFlow helps freelancers and clients agree on deliverables, secure payment up front, review work, and release funds according to agreed conditions.
              </p>

              {/* Hero Actions */}
              <div className="pt-1 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <motion.button
                    type="button"
                    onClick={onGetStarted}
                    whileHover={shouldReduceMotion ? undefined : { y: -1 }}
                    whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
                    className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-950 bg-[#F5D03A] hover:bg-[#E7BF24] transition-colors cursor-pointer whitespace-nowrap shadow-xs"
                  >
                    <span>Get started</span>
                    <ArrowRight className="w-4 h-4" />
                  </motion.button>

                  <a
                    href="#how-it-works"
                    className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2.5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-[var(--tf-surface)] border border-transparent hover:border-[var(--tf-border)] transition-colors whitespace-nowrap"
                  >
                    <span>How it works</span>
                    <ArrowDown className="w-3.5 h-3.5 opacity-60" />
                  </a>
                </div>

                {/* Early-Access / Testnet Notice near primary CTA */}
                <p className="text-xs text-[var(--tf-muted)] flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 shrink-0 opacity-75" />
                  <span>
                    Early access on Stellar Testnet · Test funds only, no real money is moved.
                  </span>
                </p>
              </div>
            </motion.div>

            {/* Lightweight Animated 4-Stage Agreement Preview */}
            <motion.div
              className="lg:col-span-5"
              initial={shouldReduceMotion ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="max-w-md mx-auto lg:mx-0 lg:ml-auto rounded-2xl bg-[var(--tf-surface)] border border-[var(--tf-border)] p-5 sm:p-6 shadow-sm">
                <div className="flex items-start justify-between gap-4 pb-4 border-b border-[var(--tf-border)]">
                  <div>
                    <div className="text-xs text-[var(--tf-muted)]">
                      Illustrative agreement preview
                    </div>
                    <div className="font-display font-semibold text-base text-slate-950 dark:text-white mt-0.5">
                      Product UI & Landing Page
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-display font-bold text-lg text-slate-950 dark:text-white tabular-nums">
                      500.00
                    </div>
                    <div className="text-xs font-medium text-[var(--tf-muted)]">
                      USDC
                    </div>
                  </div>
                </div>

                <div className="py-5 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--tf-muted)]">Stage</span>
                    <AnimatePresence mode="wait">
                      <motion.span
                        key={currentStage.id}
                        initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={shouldReduceMotion ? undefined : { opacity: 0, y: -4 }}
                        transition={{ duration: 0.22 }}
                        className={`inline-flex items-center gap-1.5 font-semibold ${
                          currentStage.tone === "emerald"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : currentStage.tone === "purple"
                            ? "text-[#4A2574] dark:text-[#F5D03A]"
                            : "text-amber-700 dark:text-amber-300"
                        }`}
                      >
                        {currentStage.tone === "emerald" ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : (
                          <Clock className="w-3.5 h-3.5" />
                        )}
                        {currentStage.badge}
                      </motion.span>
                    </AnimatePresence>
                  </div>

                  <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <motion.div
                      className={`h-full rounded-full transition-colors duration-300 ${
                        currentStage.tone === "emerald"
                          ? "bg-emerald-500"
                          : currentStage.tone === "purple"
                          ? "bg-[#4A2574] dark:bg-[#F5D03A]"
                          : "bg-amber-500"
                      }`}
                      initial={false}
                      animate={{ width: `${currentStage.progress}%` }}
                      transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </div>

                  <div className="grid grid-cols-4 gap-1 text-[11px] text-[var(--tf-muted)]">
                    <span className={currentStage.stepIndex >= 0 ? "text-slate-900 dark:text-slate-200 font-medium" : ""}>
                      Agreed
                    </span>
                    <span className={`text-center ${currentStage.stepIndex >= 1 ? "text-slate-900 dark:text-slate-200 font-medium" : ""}`}>
                      Secured
                    </span>
                    <span className={`text-center ${currentStage.stepIndex >= 2 ? "text-slate-900 dark:text-slate-200 font-medium" : ""}`}>
                      Submitted
                    </span>
                    <span className={`text-right ${currentStage.stepIndex >= 3 ? "text-slate-900 dark:text-slate-200 font-medium" : ""}`}>
                      Released
                    </span>
                  </div>
                </div>

                <div className="pt-3 border-t border-[var(--tf-border)] flex items-center justify-between gap-3 text-xs">
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={currentStage.id}
                      initial={shouldReduceMotion ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={shouldReduceMotion ? undefined : { opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="text-[var(--tf-muted)] truncate"
                    >
                      {currentStage.detail}
                    </motion.span>
                  </AnimatePresence>
                  <span className="font-medium text-slate-900 dark:text-slate-200 shrink-0">
                    Client · Freelancer
                  </span>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* How It Works — 3 Simple Stages */}
        <section
          id="how-it-works"
          className="border-t border-[var(--tf-border)] bg-[var(--tf-surface)]/45"
        >
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
            <h2 className="font-display font-bold text-xl sm:text-2xl tracking-tight text-slate-950 dark:text-white mb-7">
              How it works
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
              <div className="pt-3 border-t border-[var(--tf-border)] space-y-1.5">
                <div className="text-xs font-semibold text-[#4A2574] dark:text-[#F5D03A] tabular-nums">
                  01 — Agree
                </div>
                <p className="text-sm text-[var(--tf-muted)] leading-relaxed">
                  Set the work, amount, deadlines, and conditions.
                </p>
              </div>

              <div className="pt-3 border-t border-[var(--tf-border)] space-y-1.5">
                <div className="text-xs font-semibold text-[#4A2574] dark:text-[#F5D03A] tabular-nums">
                  02 — Secure
                </div>
                <p className="text-sm text-[var(--tf-muted)] leading-relaxed">
                  The client funds the agreement before work begins.
                </p>
              </div>

              <div className="pt-3 border-t border-[var(--tf-border)] space-y-1.5">
                <div className="text-xs font-semibold text-[#4A2574] dark:text-[#F5D03A] tabular-nums">
                  03 — Complete
                </div>
                <p className="text-sm text-[var(--tf-muted)] leading-relaxed">
                  The freelancer submits the work, the client reviews it, and funds are released according to the agreed process.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Trust & Transparency — Progressive Disclosure */}
        <section
          id="trust-transparency"
          className="border-t border-[var(--tf-border)]"
        >
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
              <div className="lg:col-span-4 space-y-4">
                <h2 className="font-display font-bold text-xl sm:text-2xl tracking-tight text-slate-950 dark:text-white">
                  Trust and transparency
                </h2>
                <p className="text-sm text-[var(--tf-muted)] leading-relaxed">
                  Clear answers on fees, disputes, deadlines, wallet access, and what is active in early access.
                </p>

                {/* Understated Founder Note */}
                <p className="text-xs text-[var(--tf-muted)] leading-relaxed pt-3 border-t border-[var(--tf-border)]">
                  TrustFlow is being built with an understanding of the challenges African freelancers face when working with clients across borders, especially when payment confidence is uncertain.
                </p>

                {/* Reserved Payment Proof Slot (Honest, Zero Fabricated Metrics) */}
                <div className="text-xs text-[var(--tf-muted)] pt-3 border-t border-[var(--tf-border)]">
                  <span className="font-medium text-slate-800 dark:text-slate-200 block mb-0.5">
                    First verified payment proof
                  </span>
                  <span>
                    Reserved for our first end-to-end Testnet settlement. No simulated transactions or metrics are shown here.
                  </span>
                </div>
              </div>

              <div className="lg:col-span-8 divide-y divide-[var(--tf-border)] border-y border-[var(--tf-border)]">
                {TRUST_TOPICS.map((topic) => {
                  const isOpen = openTopicId === topic.id;
                  return (
                    <div key={topic.id}>
                      <button
                        type="button"
                        onClick={() => setOpenTopicId(isOpen ? null : topic.id)}
                        aria-expanded={isOpen}
                        className="w-full py-3.5 text-left flex items-center justify-between gap-4 cursor-pointer group"
                      >
                        <span className="text-sm font-medium text-slate-950 dark:text-white group-hover:text-[#4A2574] dark:group-hover:text-[#F5D03A] transition-colors">
                          {topic.title}
                        </span>
                        <ChevronDown
                          className={`w-4 h-4 shrink-0 text-[var(--tf-muted)] transition-transform duration-200 ${
                            isOpen ? "rotate-180" : ""
                          }`}
                        />
                      </button>

                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <motion.div
                            initial={shouldReduceMotion ? false : { opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={shouldReduceMotion ? undefined : { opacity: 0, height: 0 }}
                            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                            className="overflow-hidden"
                          >
                            <p className="pb-4 text-xs sm:text-sm text-[var(--tf-muted)] leading-relaxed">
                              {topic.body}
                            </p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Compact Footer */}
      <footer className="border-t border-[var(--tf-border)] py-6 px-4 sm:px-6 text-xs text-[var(--tf-muted)]">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md bg-[#4A2574] flex items-center justify-center shrink-0">
              <ShieldCheck className="w-3.5 h-3.5 text-[#F5D03A]" />
            </div>
            <span className="font-display font-semibold text-slate-900 dark:text-white">
              TrustFlow
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-5">
            <a
              href="#how-it-works"
              className="hover:text-slate-950 dark:hover:text-white transition-colors"
            >
              How it works
            </a>
            <a
              href="#trust-transparency"
              className="hover:text-slate-950 dark:hover:text-white transition-colors"
            >
              Trust & transparency
            </a>
            <button
              type="button"
              onClick={onOpenApp}
              className="font-medium text-slate-900 dark:text-slate-200 hover:underline cursor-pointer"
            >
              Open app
            </button>
          </div>
        </div>

        <div className="max-w-5xl mx-auto mt-4 pt-4 border-t border-[var(--tf-border)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[11px] opacity-85">
          <span>© {new Date().getFullYear()} TrustFlow</span>
          <span>Stellar Testnet · Test funds only</span>
        </div>
      </footer>
    </div>
  );
};
