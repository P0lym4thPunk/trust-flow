import React, { useState } from "react";
import { X, ShieldCheck, Mail, ArrowRight, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import { useAuth } from "../lib/auth/AuthContext";

export const AuthModal: React.FC = () => {
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

  if (!isAuthModalOpen) return null;

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
      // Modal auto closes on successful login
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

  const resetForm = () => {
    setEmail("");
    setOtpCode("");
    setStep("input_email");
    setErrorMessage(null);
    setDemoHintCode(null);
    closeAuthModal();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-white dark:bg-[#121824] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
        {/* Stellar Yellow Highlight Bar */}
        <div className="h-1.5 w-full bg-[#F5D03A]" />

        <div className="p-6">
          {/* Close button */}
          <button
            onClick={resetForm}
            className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Heading */}
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-8 h-8 rounded-lg bg-[#4A2574] flex items-center justify-center text-[#F5D03A]">
              <ShieldCheck className="w-5 h-5 text-[#F5D03A]" />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight font-display">
                Sign in to TrustFlow
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                Simple, secure access to your payments and account
              </p>
            </div>
          </div>

          {/* Provisioning Loader View */}
          {step === "provisioning" ? (
            <div className="py-10 text-center space-y-4">
              <div className="w-12 h-12 mx-auto rounded-xl bg-[#F5D03A]/20 flex items-center justify-center text-slate-900 dark:text-[#F5D03A]">
                <RefreshCw className="w-6 h-6 animate-spin text-slate-900 dark:text-[#F5D03A]" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Preparing your account...
                </h3>
                <p className="text-xs text-slate-500 max-w-xs mx-auto">
                  Setting up your secure account and test funds. This only takes a moment.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Tab Selector */}
              <div className="flex rounded-lg bg-slate-100 dark:bg-slate-800 p-1 mb-5">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab("email");
                    setErrorMessage(null);
                  }}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer ${
                    activeTab === "email"
                      ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs"
                      : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
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
                  className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer ${
                    activeTab === "google"
                      ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs"
                      : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  Google
                </button>
              </div>

              {/* Error Banner */}
              {errorMessage && (
                <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 flex items-center gap-2 text-xs text-red-700 dark:text-red-300">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Tab 1: Email OTP */}
              {activeTab === "email" && (
                <div>
                  {step === "input_email" ? (
                    <form onSubmit={handleSendCode} className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                          Email address
                        </label>
                        <div className="relative">
                          <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                          <input
                            type="email"
                            required
                            placeholder="you@example.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-hidden focus:border-[#F5D03A] text-slate-900 dark:text-white placeholder:text-slate-400"
                          />
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1">
                          We will send a 6-digit verification code to sign you in.
                        </p>
                      </div>

                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-2.5 px-4 text-xs font-bold text-slate-950 bg-[#F5D03A] hover:bg-[#E5BF24] disabled:opacity-50 rounded-lg shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        {loading ? "Sending code..." : "Continue with email"}
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={handleVerifyCode} className="space-y-4">
                      <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs">
                        <span className="text-slate-500">Code sent to: </span>
                        <strong className="text-slate-900 dark:text-white">{email}</strong>
                        <button
                          type="button"
                          onClick={() => setStep("input_email")}
                          className="ml-2 text-xs text-[#4A2574] dark:text-[#F5D03A] underline cursor-pointer"
                        >
                          Change
                        </button>
                      </div>

                      {demoHintCode && (
                        <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-xs flex items-center justify-between text-amber-900 dark:text-amber-200">
                          <span>Verification code: <strong>{demoHintCode}</strong></span>
                          <button
                            type="button"
                            onClick={() => setOtpCode(demoHintCode)}
                            className="text-[11px] font-bold underline cursor-pointer"
                          >
                            Fill code
                          </button>
                        </div>
                      )}

                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                          Enter 6-digit code
                        </label>
                        <input
                          type="text"
                          maxLength={6}
                          required
                          placeholder="123456"
                          value={otpCode}
                          onChange={(e) => setOtpCode(e.target.value)}
                          className="w-full py-2 text-center text-lg tracking-widest font-mono font-bold bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-hidden focus:border-[#F5D03A] text-slate-900 dark:text-white"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={loading || otpCode.length < 6}
                        className="w-full py-2.5 px-4 text-xs font-bold text-slate-950 bg-[#F5D03A] hover:bg-[#E5BF24] disabled:opacity-50 rounded-lg shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        {loading ? "Verifying..." : "Confirm & enter"}
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  )}
                </div>
              )}

              {/* Tab 2: Google Sign-in */}
              {activeTab === "google" && (
                <div className="space-y-4">
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Sign in with your Google account. Your payment balance will be ready immediately.
                  </p>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                      Account name (optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Alex Rivera"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-hidden focus:border-[#F5D03A] text-slate-900 dark:text-white placeholder:text-slate-400"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    disabled={loading}
                    className="w-full py-2.5 px-4 text-xs font-bold text-slate-800 dark:text-slate-100 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-700 transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span className="text-base">🌐</span>
                    <span>Continue with Google</span>
                  </button>
                </div>
              )}
            </>
          )}

          <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800/80 text-center">
            <span className="text-[11px] text-slate-400">
              Test mode enabled · Free testnet currency
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
