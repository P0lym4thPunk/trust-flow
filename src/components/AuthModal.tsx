import React, { useState, useEffect } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { X, ShieldCheck, Mail, ArrowRight, CheckCircle2, AlertCircle, RefreshCw, Globe } from "lucide-react";
import { useAuth } from "../lib/auth/AuthContext";

interface AuthModalProps {
  onContinueDemo?: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ onContinueDemo }) => {
  const shouldReduceMotion = useReducedMotion();
  const {
    isAuthModalOpen,
    closeAuthModal,
    sendOtpCode,
    verifyOtpCode,
    loginWithGoogle,
  } = useAuth();

  const [activeTab, setActiveTab] = useState<"email" | "google">("email");
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [step, setStep] = useState<"input_email" | "enter_code" | "provisioning">("input_email");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [demoHintCode, setDemoHintCode] = useState<string | null>(null);

  const resetForm = () => {
    setEmail("");
    setOtpCode("");
    setStep("input_email");
    setErrorMessage(null);
    setDemoHintCode(null);
    closeAuthModal();
  };

  useEffect(() => {
    if (!isAuthModalOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") resetForm();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isAuthModalOpen]);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !email.includes("@")) {
      setErrorMessage("Please enter a valid email address.");
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await sendOtpCode(email.trim());
      if (res.demoCode) {
        setDemoHintCode(res.demoCode);
      }
      setStep("enter_code");
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to send code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode.trim() || otpCode.trim().length < 6) {
      setErrorMessage("Please enter the 6-digit code sent to your email.");
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    setStep("provisioning");

    try {
      await verifyOtpCode(email.trim(), otpCode.trim());
    } catch (err: any) {
      setStep("enter_code");
      setErrorMessage(err.message || "Invalid or expired code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setErrorMessage(null);
    setStep("provisioning");

    try {
      await loginWithGoogle({
        email: email.trim() || "alex.stellar@example.com",
        name: "Alex Rivera",
      });
    } catch (err: any) {
      setStep("input_email");
      setErrorMessage(err.message || "Google sign-in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isAuthModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={shouldReduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={resetForm}
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
          />

          <motion.div
            initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.97, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0, scale: 0.97, y: 10 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-md max-h-[90dvh] overflow-y-auto bg-[var(--tf-surface)]/95 backdrop-blur-md rounded-2xl border border-[var(--tf-border)] shadow-2xl z-10 p-6"
          >
            {/* Close button */}
            <button
              type="button"
              onClick={resetForm}
              className="absolute top-4 right-4 w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Close sign in dialog"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Heading */}
            <div className="flex items-center gap-3 mb-5 pr-8">
              <div className="w-9 h-9 rounded-xl bg-[#4A2574] flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5 text-[#F5D03A]" />
              </div>
              <div>
                <h2 className="text-lg font-display font-bold text-slate-950 dark:text-white tracking-tight">
                  Sign in to TrustFlow
                </h2>
                <p className="text-xs text-[var(--tf-muted)]">
                  Access your payments and balance
                </p>
              </div>
            </div>

            {step === "provisioning" ? (
              <div className="py-10 text-center space-y-3">
                <div className="w-11 h-11 mx-auto rounded-xl bg-[#F5D03A]/20 flex items-center justify-center text-slate-900 dark:text-[#F5D03A]">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-slate-950 dark:text-white">
                    Preparing your account
                  </h3>
                  <p className="text-xs text-[var(--tf-muted)] max-w-xs mx-auto">
                    Setting up your payment account and test balance.
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* Tab Selector */}
                <div className="grid grid-cols-2 rounded-xl bg-[var(--tf-surface-subtle)] p-1 mb-5">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab("email");
                      setErrorMessage(null);
                    }}
                    className={`py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                      activeTab === "email"
                        ? "bg-[var(--tf-surface)] text-slate-950 dark:text-white shadow-xs"
                        : "text-[var(--tf-muted)] hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    Email code
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab("google");
                      setErrorMessage(null);
                    }}
                    className={`py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                      activeTab === "google"
                        ? "bg-[var(--tf-surface)] text-slate-950 dark:text-white shadow-xs"
                        : "text-[var(--tf-muted)] hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    Google
                  </button>
                </div>

                {/* Error Banner */}
                {errorMessage && (
                  <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 flex items-center gap-2 text-xs text-red-700 dark:text-red-300">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                {/* Email OTP */}
                {activeTab === "email" && (
                  <div>
                    {step === "input_email" ? (
                      <form onSubmit={handleSendCode} className="space-y-4">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                            Email address
                          </label>
                          <div className="relative">
                            <Mail className="w-4 h-4 text-[var(--tf-muted)] absolute left-3.5 top-3" />
                            <input
                              type="email"
                              required
                              placeholder="you@example.com"
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-[var(--tf-surface-subtle)] border border-[var(--tf-border)] rounded-xl focus:outline-none focus:border-[#4A2574] dark:focus:border-[#F5D03A] text-slate-950 dark:text-white placeholder:text-[var(--tf-muted)]"
                            />
                          </div>
                          <p className="text-[11px] text-[var(--tf-muted)] mt-1.5">
                            We will send a 6-digit code to sign you in or create your account.
                          </p>
                        </div>

                        <button
                          type="submit"
                          disabled={loading}
                          className="w-full min-h-[44px] px-4 text-xs font-semibold text-slate-950 bg-[#F5D03A] hover:bg-[#E7BF24] disabled:opacity-50 rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <span>{loading ? "Sending code..." : "Continue with email"}</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </form>
                    ) : (
                      <form onSubmit={handleVerifyCode} className="space-y-4">
                        <div className="p-3 rounded-xl bg-[var(--tf-surface-subtle)] border border-[var(--tf-border)] text-xs flex items-center justify-between gap-2">
                          <span className="text-[var(--tf-muted)] truncate">
                            Code sent to <strong className="text-slate-950 dark:text-white">{email}</strong>
                          </span>
                          <button
                            type="button"
                            onClick={() => setStep("input_email")}
                            className="text-xs font-medium text-[#4A2574] dark:text-[#F5D03A] hover:underline shrink-0 cursor-pointer"
                          >
                            Change
                          </button>
                        </div>

                        {demoHintCode && (
                          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-xs flex items-center justify-between text-amber-900 dark:text-amber-200">
                            <span>
                              Verification code: <strong className="font-mono">{demoHintCode}</strong>
                            </span>
                            <button
                              type="button"
                              onClick={() => setOtpCode(demoHintCode)}
                              className="text-xs font-semibold underline cursor-pointer"
                            >
                              Fill code
                            </button>
                          </div>
                        )}

                        <div>
                          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                            6-digit code
                          </label>
                          <input
                            type="text"
                            maxLength={6}
                            required
                            placeholder="123456"
                            value={otpCode}
                            onChange={(e) => setOtpCode(e.target.value)}
                            className="w-full py-2.5 text-center text-lg tracking-widest font-mono font-bold bg-[var(--tf-surface-subtle)] border border-[var(--tf-border)] rounded-xl focus:outline-none focus:border-[#4A2574] dark:focus:border-[#F5D03A] text-slate-950 dark:text-white"
                          />
                        </div>

                        <button
                          type="submit"
                          disabled={loading || otpCode.length < 6}
                          className="w-full min-h-[44px] px-4 text-xs font-semibold text-slate-950 bg-[#F5D03A] hover:bg-[#E7BF24] disabled:opacity-50 rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <span>{loading ? "Verifying..." : "Confirm and continue"}</span>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        </button>
                      </form>
                    )}
                  </div>
                )}

                {/* Google Sign-in */}
                {activeTab === "google" && (
                  <div className="space-y-4">
                    <p className="text-xs text-[var(--tf-muted)] leading-relaxed">
                      Sign in with Google to get started with a ready payment account.
                    </p>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                        Display name (optional)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Alex Rivera"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm bg-[var(--tf-surface-subtle)] border border-[var(--tf-border)] rounded-xl focus:outline-none focus:border-[#4A2574] dark:focus:border-[#F5D03A] text-slate-950 dark:text-white placeholder:text-[var(--tf-muted)]"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handleGoogleLogin}
                      disabled={loading}
                      className="w-full min-h-[44px] px-4 text-xs font-semibold text-slate-900 dark:text-white bg-[var(--tf-surface-subtle)] hover:bg-slate-200/70 dark:hover:bg-slate-800 rounded-xl border border-[var(--tf-border)] transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Globe className="w-4 h-4 text-[#4A2574] dark:text-[#F5D03A]" />
                      <span>Continue with Google</span>
                    </button>
                  </div>
                )}
              </>
            )}

            <div className="mt-5 pt-4 border-t border-[var(--tf-border)] flex flex-col items-center gap-2 text-center">
              {onContinueDemo && step !== "provisioning" && (
                <button
                  type="button"
                  onClick={onContinueDemo}
                  className="text-xs font-medium text-[var(--tf-muted)] hover:text-slate-950 dark:hover:text-white transition-colors cursor-pointer"
                >
                  Continue in test mode
                </button>
              )}
              <span className="text-[11px] text-[var(--tf-muted)] opacity-80">
                Test network mode · No real funds
              </span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
