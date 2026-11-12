import React from "react";
import { ShieldCheck, ArrowRight, Zap, CheckCircle2, Lock, Sparkles, Scale } from "lucide-react";

interface LandingProps {
  onLaunch: (selectedType?: "WORK" | "PROTECTED_PAYMENT" | "CONDITIONAL_DISBURSEMENT") => void;
}

export const LandingPage: React.FC<LandingProps> = ({ onLaunch }) => {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0B0E14] text-slate-900 dark:text-slate-100 transition-colors">
      {/* Top Header */}
      <header className="border-b border-slate-200 dark:border-slate-800/80 bg-white/80 dark:bg-[#0B0E14]/80 backdrop-blur sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#4A2574] to-[#F5D03A] flex items-center justify-center text-white font-bold shadow-sm">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="font-extrabold text-lg tracking-tight leading-none text-slate-900 dark:text-white">
                TrustFlow
              </span>
              <span className="text-[10px] text-slate-500 font-medium tracking-wide">
                STELLAR SOROBAN ESCROW
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <span className="hidden sm:inline-flex text-xs font-semibold px-2.5 py-1 rounded bg-[#F5D03A]/20 text-[#8F6E00] dark:text-[#F5D03A] border border-[#F5D03A]/30">
              Stellar Testnet Prototype
            </span>
            <button
              onClick={() => onLaunch()}
              className="px-4 py-2 text-sm font-semibold text-slate-900 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-lg shadow-sm transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              Launch App
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-16 pb-20 px-4 sm:px-6 max-w-5xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-purple-50 dark:bg-purple-950/40 text-[#4A2574] dark:text-purple-300 border border-purple-200 dark:border-purple-800/40 mb-6">
          <Sparkles className="w-3.5 h-3.5 text-[#F5D03A]" />
          <span>AI-Assisted Protected Payments on Stellar</span>
        </div>

        <h1 className="text-4xl sm:text-6xl font-black tracking-tight leading-[1.1] mb-6 text-slate-900 dark:text-white max-w-4xl mx-auto">
          Stellar is where conditional payments{" "}
          <span className="stellar-highlight dark:stellar-highlight px-1">
            meet the real world.
          </span>
        </h1>

        <p className="text-lg sm:text-xl text-slate-600 dark:text-slate-300 max-w-2xl mx-auto mb-10 leading-relaxed">
          Create, fund, and complete protected agreements in plain English.
          Soroban smart contracts hold funds securely and release payment only
          when the agreed conditions are verified.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 max-w-md mx-auto">
          <button
            onClick={() => onLaunch("WORK")}
            className="w-full sm:w-auto px-6 py-3.5 text-base font-bold text-slate-900 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            Create Agreement
            <ArrowRight className="w-5 h-5" />
          </button>
          <a
            href="#how-it-works"
            className="w-full sm:w-auto px-6 py-3.5 text-base font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl transition-all text-center"
          >
            How It Works
          </a>
        </div>

        {/* Core Product Promise Banner */}
        <div className="mt-12 p-4 rounded-xl bg-purple-50 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-900/40 max-w-2xl mx-auto flex items-center justify-center gap-3 text-sm text-[#4A2574] dark:text-purple-300 font-semibold">
          <Lock className="w-4 h-4 text-[#F5D03A]" />
          <span>Core Promise: Money moves only when the agreed condition is satisfied.</span>
        </div>
      </section>

      {/* Three Transaction Templates */}
      <section className="py-16 px-4 sm:px-6 max-w-6xl mx-auto border-t border-slate-200 dark:border-slate-800">
        <div className="text-center mb-12">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white mb-3">
            Three Experiences, One Reusable Escrow Engine
          </h2>
          <p className="text-slate-600 dark:text-slate-400 max-w-xl mx-auto text-sm sm:text-base">
            Every transaction is powered by the same verified Soroban smart contract on Stellar Testnet.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 1: Work-based Escrow */}
          <div className="bg-white dark:bg-slate-900/80 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-[#F5D03A]/60 transition-all flex flex-col justify-between shadow-sm">
            <div>
              <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-950/50 flex items-center justify-center text-amber-600 dark:text-[#F5D03A] mb-4">
                <Zap className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                Work-Based Escrow
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">
                For freelance design, software engineering, and consulting. Agree on deliverables,
                deposit tokens, review submitted work, and release payment on approval.
              </p>
              <div className="text-xs text-slate-500 space-y-1.5 mb-6">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Client & Contractor dual acceptance</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Mandatory deliverable submission</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Approver authorization required</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => onLaunch("WORK")}
              className="w-full py-2.5 px-4 text-xs font-bold text-slate-900 bg-slate-100 hover:bg-[#F5D03A] dark:bg-slate-800 dark:text-white dark:hover:text-slate-900 dark:hover:bg-[#F5D03A] rounded-lg transition-colors flex items-center justify-center gap-1 cursor-pointer"
            >
              Start Work Escrow
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Card 2: Protected Everyday Payments */}
          <div className="bg-white dark:bg-slate-900/80 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-[#F5D03A]/60 transition-all flex flex-col justify-between shadow-sm">
            <div>
              <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-950/50 flex items-center justify-center text-[#4A2574] dark:text-purple-300 mb-4">
                <Scale className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                Everyday Purchases
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">
                For private peer-to-peer sales, bookings, and custom goods. Buyer deposits funds; seller
                ships and confirms; buyer verifies inspection before release.
              </p>
              <div className="text-xs text-slate-500 space-y-1.5 mb-6">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Buyer & Seller plain terms</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Delivery confirmation checklist</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Mutual cancellation protected</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => onLaunch("PROTECTED_PAYMENT")}
              className="w-full py-2.5 px-4 text-xs font-bold text-slate-900 bg-slate-100 hover:bg-[#F5D03A] dark:bg-slate-800 dark:text-white dark:hover:text-slate-900 dark:hover:bg-[#F5D03A] rounded-lg transition-colors flex items-center justify-center gap-1 cursor-pointer"
            >
              Start Protected Payment
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Card 3: Conditional Disbursements */}
          <div className="bg-white dark:bg-slate-900/80 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-[#F5D03A]/60 transition-all flex flex-col justify-between shadow-sm">
            <div>
              <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-950/50 flex items-center justify-center text-blue-600 dark:text-blue-400 mb-4">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                Conditional Grants
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">
                For organizations, NGOs, and project leads allocating bounties. Lock funds in escrow
                and disburse only when verified project milestones are confirmed.
              </p>
              <div className="text-xs text-slate-500 space-y-1.5 mb-6">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Grantor & Grantee commitment</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Designated approver milestone verification</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Timeout refund if unfulfilled</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => onLaunch("CONDITIONAL_DISBURSEMENT")}
              className="w-full py-2.5 px-4 text-xs font-bold text-slate-900 bg-slate-100 hover:bg-[#F5D03A] dark:bg-slate-800 dark:text-white dark:hover:text-slate-900 dark:hover:bg-[#F5D03A] rounded-lg transition-colors flex items-center justify-center gap-1 cursor-pointer"
            >
              Start Conditional Grant
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-16 px-4 sm:px-6 max-w-5xl mx-auto border-t border-slate-200 dark:border-slate-800">
        <h2 className="text-2xl sm:text-3xl font-bold text-center text-slate-900 dark:text-white mb-12">
          How Protected Payments Work
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-6 text-center">
          <div className="flex flex-col items-center">
            <div className="w-12 h-12 rounded-full bg-[#F5D03A]/20 text-slate-900 dark:text-[#F5D03A] flex items-center justify-center font-black text-lg mb-4">
              1
            </div>
            <h4 className="font-bold text-base mb-1">Describe</h4>
            <p className="text-xs text-slate-500 leading-relaxed">
              Use TrustFlow Assistant to describe deliverables, amount, and deadline in plain English.
            </p>
          </div>

          <div className="flex flex-col items-center">
            <div className="w-12 h-12 rounded-full bg-[#F5D03A]/20 text-slate-900 dark:text-[#F5D03A] flex items-center justify-center font-black text-lg mb-4">
              2
            </div>
            <h4 className="font-bold text-base mb-1">Agree</h4>
            <p className="text-xs text-slate-500 leading-relaxed">
              Both parties review and explicitly accept the canonical terms on-chain.
            </p>
          </div>

          <div className="flex flex-col items-center">
            <div className="w-12 h-12 rounded-full bg-[#F5D03A]/20 text-slate-900 dark:text-[#F5D03A] flex items-center justify-center font-black text-lg mb-4">
              3
            </div>
            <h4 className="font-bold text-base mb-1">Fund</h4>
            <p className="text-xs text-slate-500 leading-relaxed">
              Payer signs the transaction via Freighter wallet. Tokens are locked in Soroban escrow.
            </p>
          </div>

          <div className="flex flex-col items-center">
            <div className="w-12 h-12 rounded-full bg-[#F5D03A]/20 text-slate-900 dark:text-[#F5D03A] flex items-center justify-center font-black text-lg mb-4">
              4
            </div>
            <h4 className="font-bold text-base mb-1">Complete</h4>
            <p className="text-xs text-slate-500 leading-relaxed">
              Recipient submits deliverables; approver confirms; smart contract releases funds.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 py-8 px-4 sm:px-6 text-center text-xs text-slate-500">
        <p className="mb-2">
          TrustFlow — Prototype built for Stellar Testnet using Soroban smart contracts.
        </p>
        <p>
          Powered by Gemini 3.8 Flash · Not intended for mainnet or production financial custody.
        </p>
      </footer>
    </div>
  );
};
