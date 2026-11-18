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
    capabilities,
    authStage,
    syncError,
    isAuthenticated,
    isPrivyConfigured,
    sendOtpCode,
    verifyOtpCode,
    loginWithGoogle,
    retryPrivySync,
    logout,
    enterSandbox,
    activePrivySub,
    isPrivyWalletTestMode,
  } = useAuth();

  const [activeTab, setActiveTab] = useState<"email" | "google">("email");
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [step, setStep] = useState<"input_email" | "enter_code" | "provisioning">("input_email");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isLifecycleProgress =
    authStage === "privy_authenticated" ||
    authStage === "wallet_loading" ||
    authStage === "wallet_ready" ||
    authStage === "backend_syncing";
  const isSyncRecovery = authStage === "sync_failed" && Boolean(syncError);

  const resetForm = () => {
    setEmail("");
    setOtpCode("");
    setStep("input_email");
    setErrorMessage(null);
    setLoading(false);
    closeAuthModal();
  };

  useEffect(() => {
    if (!isAuthModalOpen || isAuthenticated) {
      setOtpCode("");
      setErrorMessage(null);
      setLoading(false);
      if (isAuthenticated || authStage === "unauthenticated") {
        setStep("input_email");
      }
    }
  }, [isAuthModalOpen, isAuthenticated, authStage]);

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
      await sendOtpCode(email.trim());
      setStep("enter_code");
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to send verification code.");
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
      await loginWithGoogle();
    } catch (err: any) {
      setStep("input_email");
      setErrorMessage(err.message || "Google sign-in is unavailable.");
    } finally {
      setLoading(false);
    }
  };

  const handleRetrySync = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      await retryPrivySync();
    } catch (err: any) {
      setErrorMessage(err.message || "Synchronization failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSignOutAndReset = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      await logout();
      setStep("input_email");
      setOtpCode("");
      setActiveTab("email");
    } finally {
      setLoading(false);
    }
  };

  const handleEnterSandbox = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      await enterSandbox("alice");
      if (onContinueDemo) onContinueDemo();
    } catch (err: any) {
      setErrorMessage(err.message || "Unable to start development sandbox.");
    } finally {
      setLoading(false);
    }
  };

  const emailEnabled = isPrivyConfigured || capabilities.emailOtpConfigured;
  const googleEnabled = isPrivyConfigured || capabilities.googleConfigured;
  const isProdMissingPrivy =
    !isPrivyConfigured && (import.meta.env.PROD || Boolean(capabilities.legacyAuthDisabled));

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
                  Access your agreements and payment workspace
                </p>
              </div>
            </div>

            {isSyncRecovery && syncError ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 space-y-2">
                  <div className="flex items-start gap-2.5 text-sm font-semibold text-red-800 dark:text-red-200">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      {syncError.requiresReauth
                        ? "Session verification expired"
                        : "Account synchronization incomplete"}
                    </span>
                  </div>
                  <p className="text-xs text-red-700 dark:text-red-300 leading-relaxed pl-6">
                    {syncError.message}
                  </p>
                  {isPrivyWalletTestMode && (syncError.privySub || activePrivySub) && (
                    <div className="ml-6 mt-2 p-2.5 rounded-lg bg-[var(--tf-surface)] border border-[var(--tf-border)] text-[11px] text-slate-700 dark:text-slate-200 space-y-1">
                      <div className="font-semibold">Privy Wallet Test Mode (Dev Only)</div>
                      <div className="font-mono break-all select-all">
                        Privy User ID: {syncError.privySub || activePrivySub}
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-2.5">
                  {syncError.canRetrySync && !syncError.requiresReauth && (
                    <button
                      type="button"
                      onClick={handleRetrySync}
                      disabled={loading}
                      className="w-full min-h-[44px] px-4 text-xs font-semibold text-slate-950 bg-[#F5D03A] hover:bg-[#E7BF24] disabled:opacity-50 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                      <span>{loading ? "Retrying synchronization..." : "Retry synchronization"}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleSignOutAndReset}
                    disabled={loading}
                    className="w-full min-h-[44px] px-4 text-xs font-semibold text-slate-900 dark:text-white bg-[var(--tf-surface-subtle)] hover:bg-slate-200/70 dark:hover:bg-slate-800 disabled:opacity-50 rounded-xl border border-[var(--tf-border)] transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>
                      {syncError.requiresReauth ? "Sign in again" : "Sign out and use another account"}
                    </span>
                  </button>
                </div>
              </div>
            ) : isLifecycleProgress || step === "provisioning" ? (
              <div className="py-10 text-center space-y-3">
                <div className="w-11 h-11 mx-auto rounded-xl bg-[#F5D03A]/20 flex items-center justify-center text-slate-900 dark:text-[#F5D03A]">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-slate-950 dark:text-white">
                    {authStage === "privy_authenticated" || authStage === "wallet_loading"
                      ? "Preparing your Stellar wallet"
                      : "Verifying your session"}
                  </h3>
                  <p className="text-xs text-[var(--tf-muted)] max-w-xs mx-auto">
                    {authStage === "privy_authenticated" || authStage === "wallet_loading"
                      ? "Preparing your embedded Stellar wallet and session."
                      : authStage === "wallet_ready" || authStage === "backend_syncing"
                      ? "Synchronizing your verified wallet and account with TrustFlow."
                      : "Confirming credentials with the server."}
                  </p>
                </div>
              </div>
            ) : isProdMissingPrivy ? (
              <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 space-y-2">
                <div className="flex items-start gap-2.5 text-sm font-semibold text-amber-900 dark:text-amber-200">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Authentication unavailable</span>
                </div>
                <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed pl-6">
                  Privy sign-in is required in production and is not configured for this environment yet.
                </p>
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
                  <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 flex items-start gap-2 text-xs text-red-700 dark:text-red-300">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                {/* Email OTP */}
                {activeTab === "email" && (
                  <div>
                    {!emailEnabled && (
                      <div className="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                        Email delivery is not configured on this server yet.
                        {capabilities.devSandboxEnabled
                          ? " Use the development test sandbox below to explore multi-party flows."
                          : ""}
                      </div>
                    )}

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
                            We will send a 6-digit verification code to sign in.
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
                      {googleEnabled
                        ? "Sign in securely using your verified Google account."
                        : "Google OAuth is not configured on this server (missing GOOGLE_CLIENT_ID / Privy configuration)."}
                    </p>

                    <button
                      type="button"
                      onClick={handleGoogleLogin}
                      disabled={loading || !googleEnabled}
                      className="w-full min-h-[44px] px-4 text-xs font-semibold text-slate-900 dark:text-white bg-[var(--tf-surface-subtle)] hover:bg-slate-200/70 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl border border-[var(--tf-border)] transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Globe className="w-4 h-4 text-[#4A2574] dark:text-[#F5D03A]" />
                      <span>Continue with Google</span>
                    </button>
                  </div>
                )}
              </>
            )}

            <div className="mt-5 pt-4 border-t border-[var(--tf-border)] flex flex-col items-center gap-2 text-center">
              {capabilities.devSandboxEnabled && !isLifecycleProgress && !isSyncRecovery && step !== "provisioning" && (
                <button
                  type="button"
                  onClick={handleEnterSandbox}
                  disabled={loading}
                  className="text-xs font-medium text-[#4A2574] dark:text-[#F5D03A] hover:underline transition-colors cursor-pointer disabled:opacity-50"
                >
                  Continue in development test sandbox
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
