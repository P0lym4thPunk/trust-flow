import React from "react";
import { ShieldCheck, ArrowRight, CheckCircle2, Lock, Sparkles, HelpCircle } from "lucide-react";
import { useAuth } from "../lib/auth/AuthContext";

interface LandingProps {
  onLaunch: (selectedType?: "WORK" | "PROTECTED_PAYMENT" | "CONDITIONAL_DISBURSEMENT") => void;
}

export const LandingPage: React.FC<LandingProps> = ({ onLaunch }) => {
  const { user, isAuthenticated, openAuthModal } = useAuth();

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B0E14] text-slate-900 dark:text-slate-100 transition-colors">
      {/* Top Header */}
      <header className="border-b border-slate-200 dark:border-slate-800/80 bg-white/90 dark:bg-[#0B0E14]/90 backdrop-blur sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#4A2574] flex items-center justify-center text-[#F5D03A] shadow-xs">
              <ShieldCheck className="w-5 h-5 text-[#F5D03A]" />
            </div>
            <div className="flex flex-col">
              <span className="font-extrabold text-lg tracking-tight leading-none font-display">
                TrustFlow
              </span>
              <span className="text-[11px] text-slate-500 font-medium">
                Protected payments
              </span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-sm font-semibold text-slate-600 dark:text-slate-300">
            <a href="#how-it-works" className="hover:text-slate-900 dark:hover:text-white transition-colors">
              How it works
            </a>
            <a href="#use-cases" className="hover:text-slate-900 dark:hover:text-white transition-colors">
              Use cases
            </a>
            <a href="#security" className="hover:text-slate-900 dark:hover:text-white transition-colors">
              Security
            </a>
          </nav>

          <div className="flex items-center gap-3">
            {isAuthenticated ? (
              <div className="flex items-center gap-2">
                <span className="hidden sm:inline-flex text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {user?.avatar} {user?.displayName}
                </span>
                <button
                  onClick={() => onLaunch()}
                  className="px-4 py-2 text-sm font-bold text-slate-950 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-lg shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  Go to workspace
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={openAuthModal}
                  className="px-3.5 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white border border-slate-300 dark:border-slate-700 rounded-lg hover:border-[#F5D03A] transition-colors cursor-pointer"
                >
                  Sign in
                </button>
                <button
                  onClick={() => onLaunch()}
                  className="px-4 py-2 text-sm font-bold text-slate-950 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-lg shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  Get started
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-16 sm:pt-24 pb-16 px-4 sm:px-6 max-w-5xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-purple-50 dark:bg-purple-950/40 text-[#4A2574] dark:text-purple-300 border border-purple-200 dark:border-purple-800/40 mb-6">
          <Sparkles className="w-3.5 h-3.5 text-[#F5D03A]" />
          <span>Conditional payments made simple</span>
        </div>

        <h1 className="text-4xl sm:text-6xl font-black tracking-tight leading-[1.1] mb-6 text-slate-950 dark:text-white font-display max-w-4xl mx-auto uppercase">
          Payments you can trust.{" "}
          <span className="stellar-highlight dark:stellar-highlight px-1 text-slate-950 dark:text-white">
            Work you can prove.
          </span>
        </h1>

        <p className="text-lg sm:text-xl text-slate-600 dark:text-slate-300 max-w-2xl mx-auto mb-10 leading-relaxed font-normal">
          Agree on the terms, secure the payment and release the money when the work is done.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 max-w-md mx-auto">
          <button
            onClick={() => onLaunch("WORK")}
            className="w-full sm:w-auto px-6 py-3.5 text-base font-bold text-slate-950 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            Get started
            <ArrowRight className="w-5 h-5" />
          </button>
          <a
            href="#how-it-works"
            className="w-full sm:w-auto px-6 py-3.5 text-base font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-xl transition-all text-center"
          >
            How it works
          </a>
        </div>

        {/* Central Promise Banner */}
        <div className="mt-12 p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 max-w-2xl mx-auto flex items-center justify-center gap-3 text-sm text-slate-800 dark:text-slate-200 font-semibold shadow-xs">
          <div className="w-6 h-6 rounded-md bg-[#F5D03A] text-slate-950 flex items-center justify-center shrink-0">
            <Lock className="w-3.5 h-3.5" />
          </div>
          <span>The central promise: Money moves when the agreed condition is met.</span>
        </div>
      </section>

      {/* Reference Image Style: Highlighted Stat Section */}
      <section className="py-12 px-4 sm:px-6 max-w-5xl mx-auto">
        <div className="bg-[#121824] text-white p-6 sm:p-10 rounded-2xl border-2 border-dashed border-[#F5D03A]/60 shadow-xl relative overflow-hidden">
          <div className="mb-6">
            <div className="text-xs uppercase tracking-widest text-[#F5D03A] font-bold mb-1">
              Protected Payments at a Glance
            </div>
            <h2 className="text-2xl sm:text-3xl font-black font-display tracking-tight uppercase">
              How TrustFlow Moves Money
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 mt-2 max-w-xl">
              No technical setup, no complex intermediaries. Funds stay securely reserved until the recipient satisfies the verified criteria.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="bg-white text-slate-950 p-6 rounded-xl shadow-md flex flex-col justify-between">
              <div>
                <div className="text-4xl sm:text-5xl font-black font-display tracking-tight text-slate-950 stat-highlight">
                  100%
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                  Protected reservation
                </span>
                <p className="text-xs text-slate-500 mt-0.5">
                  Money is reserved and cannot be taken back without agreement or timeout.
                </p>
              </div>
            </div>

            <div className="bg-white text-slate-950 p-6 rounded-xl shadow-md flex flex-col justify-between">
              <div>
                <div className="text-4xl sm:text-5xl font-black font-display tracking-tight text-slate-950 stat-highlight">
                  3 Steps
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                  Simple workflow
                </span>
                <p className="text-xs text-slate-500 mt-0.5">
                  Agree on terms, add money, and release payment when satisfied.
                </p>
              </div>
            </div>

            <div className="bg-white text-slate-950 p-6 rounded-xl shadow-md flex flex-col justify-between sm:col-span-2 lg:col-span-1">
              <div>
                <div className="text-4xl sm:text-5xl font-black font-display tracking-tight text-slate-950 stat-highlight">
                  2-Party
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                  Dual agreement
                </span>
                <p className="text-xs text-slate-500 mt-0.5">
                  Both participants review and confirm the exact terms before payment starts.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Three Simple Use Cases */}
      <section id="use-cases" className="py-16 px-4 sm:px-6 max-w-6xl mx-auto border-t border-slate-200 dark:border-slate-800">
        <div className="text-center mb-12">
          <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">
            Real-world scenarios
          </div>
          <h2 className="text-2xl sm:text-4xl font-extrabold text-slate-900 dark:text-white font-display mb-3 uppercase">
            Three simple ways to use TrustFlow
          </h2>
          <p className="text-slate-600 dark:text-slate-400 max-w-xl mx-auto text-sm sm:text-base">
            Whether you are working, shopping, or allocating funds, TrustFlow removes payment uncertainty.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 1: Hire and pay */}
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col justify-between shadow-xs hover:border-[#F5D03A] transition-all">
            <div>
              <div className="w-10 h-10 rounded-lg bg-[#F5D03A]/20 text-slate-950 dark:text-[#F5D03A] flex items-center justify-center font-bold mb-4">
                1
              </div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                Hire and pay
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
                For freelance design, software, writing and consulting. Put money aside in advance; release it when you review and approve the submitted work.
              </p>
              <div className="text-xs text-slate-600 dark:text-slate-400 space-y-2 mb-6">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Both parties review and accept terms</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Deliverables submitted for review</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>One-click approval and payment release</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => onLaunch("WORK")}
              className="w-full py-2.5 px-4 text-xs font-bold text-slate-950 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              Start hire and pay
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Card 2: Buy with confidence */}
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col justify-between shadow-xs hover:border-[#F5D03A] transition-all">
            <div>
              <div className="w-10 h-10 rounded-lg bg-[#4A2574]/15 text-[#4A2574] dark:text-purple-300 flex items-center justify-center font-bold mb-4">
                2
              </div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                Buy with confidence
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
                For everyday purchases, private sales, and custom orders. The seller knows the money is ready; the buyer confirms delivery before it is sent.
              </p>
              <div className="text-xs text-slate-600 dark:text-slate-400 space-y-2 mb-6">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Agreed price and delivery condition</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Seller provides shipment tracking</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Funds release only upon receipt</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => onLaunch("PROTECTED_PAYMENT")}
              className="w-full py-2.5 px-4 text-xs font-bold text-slate-950 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              Start protected purchase
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Card 3: Send money with conditions */}
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col justify-between shadow-xs hover:border-[#F5D03A] transition-all">
            <div>
              <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 flex items-center justify-center font-bold mb-4">
                3
              </div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                Send money with conditions
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
                For community bounties, grants, or milestone disbursements. Allocate funds that unlock when specific, verified goals are achieved.
              </p>
              <div className="text-xs text-slate-600 dark:text-slate-400 space-y-2 mb-6">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Explicit objective criteria</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Designated reviewer verification</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Automatic refund if deadline passes</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => onLaunch("CONDITIONAL_DISBURSEMENT")}
              className="w-full py-2.5 px-4 text-xs font-bold text-slate-950 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              Start milestone payment
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </section>

      {/* The 3-Step Process */}
      <section id="how-it-works" className="py-16 px-4 sm:px-6 max-w-5xl mx-auto border-t border-slate-200 dark:border-slate-800">
        <div className="text-center mb-12">
          <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">
            Simple flow
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white font-display mb-3 uppercase">
            How it works in three steps
          </h2>
          <p className="text-slate-600 dark:text-slate-400 max-w-md mx-auto text-sm">
            Everything is straightforward. You and your counterparty always know what happens next.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-left">
            <div className="w-10 h-10 rounded-lg bg-[#F5D03A] text-slate-950 font-black text-base flex items-center justify-center mb-4">
              1
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
              Agree on the terms
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              State who is paying, who is receiving, how much is involved, and what must be delivered or proven. Both participants review and accept.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-left">
            <div className="w-10 h-10 rounded-lg bg-[#F5D03A] text-slate-950 font-black text-base flex items-center justify-center mb-4">
              2
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
              Secure the payment
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              The payer adds the agreed money. The funds are securely locked in an independent protected account so the recipient knows the money is ready.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-left">
            <div className="w-10 h-10 rounded-lg bg-[#F5D03A] text-slate-950 font-black text-base flex items-center justify-center mb-4">
              3
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
              Release the money
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              When the work is submitted or condition is verified, the payment is released directly to the recipient with a single click.
            </p>
          </div>
        </div>

        <div className="mt-12 text-center">
          <button
            onClick={() => onLaunch()}
            className="px-6 py-3 text-sm font-bold text-slate-950 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-xl shadow-xs transition-all inline-flex items-center gap-2 cursor-pointer"
          >
            Create your first protected payment
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </section>

      {/* Security & Peace of Mind */}
      <section id="security" className="py-16 px-4 sm:px-6 max-w-4xl mx-auto border-t border-slate-200 dark:border-slate-800">
        <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row items-center gap-6">
          <div className="w-16 h-16 rounded-2xl bg-[#4A2574] text-[#F5D03A] flex items-center justify-center shrink-0">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <div className="space-y-2 text-center md:text-left">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white font-display">
              Built with mathematical certainty
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Once money is added to a protected agreement, nobody—not even TrustFlow—can move it unless the agreed approval occurs or a mutual cancellation is confirmed.
            </p>
          </div>
        </div>
      </section>

      {/* Simple Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 py-10 px-4 sm:px-6 text-xs text-slate-500">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-[#4A2574] text-[#F5D03A] flex items-center justify-center font-bold text-xs">
              T
            </div>
            <span className="font-bold text-slate-800 dark:text-slate-200">TrustFlow</span>
            <span>· Payments you can trust</span>
          </div>

          <div className="flex items-center gap-6">
            <a href="#how-it-works" className="hover:text-slate-900 dark:hover:text-white transition-colors">
              How it works
            </a>
            <a href="#use-cases" className="hover:text-slate-900 dark:hover:text-white transition-colors">
              Use cases
            </a>
            <button
              onClick={() => onLaunch()}
              className="text-[#4A2574] dark:text-[#F5D03A] font-semibold hover:underline cursor-pointer"
            >
              Open app
            </button>
          </div>
        </div>
        <div className="max-w-6xl mx-auto mt-6 pt-6 border-t border-slate-200/60 dark:border-slate-800/60 text-center text-[11px] text-slate-400">
          Running in test network mode for demonstration. Funds used are test currency with zero real-world value.
        </div>
      </footer>
    </div>
  );
};
