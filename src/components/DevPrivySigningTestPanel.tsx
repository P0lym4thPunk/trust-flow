import React, { useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSignRawHash } from "@privy-io/react-auth/extended-chains";
import { ShieldCheck, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import { IS_PRIVY_WALLET_TEST_MODE, useAuth } from "../lib/auth/AuthContext";
import {
  EXPECTED_TEST_PRIVY_USER_ID,
  EXPECTED_TEST_STELLAR_ADDRESS,
  TEST_HASH_LABEL,
  executeNonBroadcastSigningTest,
  validateTestSigningEligibility,
  type NonBroadcastSigningTestResult,
} from "../lib/auth/privySigningTest";
import type { PrivyUserLike } from "../lib/auth/privyLifecycle";

/**
 * TEMPORARY PHASE 2.2A STEP 6 DEV-ONLY SIGNING TEST PANEL.
 * Only mounted when !import.meta.env.PROD && VITE_PRIVY_WALLET_TEST_MODE === "true",
 * and only renders for the exact test Privy identity and embedded Stellar address.
 */
export const DevPrivySigningTestPanel: React.FC = () => {
  const { ready, authenticated, user: privyUser } = usePrivy();
  const { isPrivyWalletTestMode } = useAuth();
  const { signRawHash } = useSignRawHash();

  const [isSigning, setIsSigning] = useState(false);
  const [result, setResult] = useState<NonBroadcastSigningTestResult | null>(null);
  const inFlightRef = useRef(false);

  const eligibilityInput = {
    isProd: Boolean(import.meta.env.PROD),
    viteWalletTestMode:
      !import.meta.env.PROD && import.meta.env.VITE_PRIVY_WALLET_TEST_MODE === "true",
    controllerTestMode: IS_PRIVY_WALLET_TEST_MODE && isPrivyWalletTestMode,
    privyReady: ready,
    privyAuthenticated: authenticated,
    privyUser: (privyUser as PrivyUserLike | null | undefined) ?? null,
  };

  const eligibility = validateTestSigningEligibility(eligibilityInput);
  if (!eligibility.eligible) {
    return null;
  }

  const handleRunSigningTest = async () => {
    if (inFlightRef.current || isSigning) {
      return;
    }

    inFlightRef.current = true;
    setIsSigning(true);
    setResult(null);

    try {
      const testResult = await executeNonBroadcastSigningTest({
        eligibilityInput,
        signRawHash: (input) => signRawHash(input),
      });
      setResult(testResult);
    } finally {
      inFlightRef.current = false;
      setIsSigning(false);
    }
  };

  return (
    <aside
      aria-label="Development Privy Stellar signing test panel"
      className="fixed bottom-4 right-4 z-[60] w-[calc(100vw-2rem)] max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-amber-400/60 dark:border-amber-500/40 bg-[var(--tf-surface)]/95 backdrop-blur-md shadow-2xl p-4 space-y-3 text-xs"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#4A2574] flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4 h-4 text-[#F5D03A]" />
          </div>
          <div>
            <div className="font-semibold text-slate-950 dark:text-white">
              Dev-Only Signing Test (Phase 2.2A)
            </div>
            <div className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
              Test mode active · Non-broadcast
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-[var(--tf-surface-subtle)] border border-[var(--tf-border)] p-2.5 space-y-1.5 text-[11px]">
        <div>
          <span className="text-[var(--tf-muted)]">Expected Privy identity:</span>
          <div className="font-mono break-all text-slate-900 dark:text-slate-100 select-all">
            {EXPECTED_TEST_PRIVY_USER_ID}
          </div>
        </div>
        <div>
          <span className="text-[var(--tf-muted)]">Expected Stellar public address:</span>
          <div className="font-mono break-all text-slate-900 dark:text-slate-100 select-all">
            {EXPECTED_TEST_STELLAR_ADDRESS}
          </div>
        </div>
        <div>
          <span className="text-[var(--tf-muted)]">Test payload:</span>
          <div className="font-mono break-all text-slate-700 dark:text-slate-300">
            SHA-256(&quot;{TEST_HASH_LABEL}&quot;) · 32 bytes
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={handleRunSigningTest}
        disabled={isSigning}
        className="w-full min-h-[40px] px-3.5 py-2 text-xs font-semibold text-slate-950 bg-[#F5D03A] hover:bg-[#E7BF24] disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer"
      >
        {isSigning ? (
          <>
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>Signing & verifying...</span>
          </>
        ) : (
          <span>Run signing test</span>
        )}
      </button>

      {result && (
        <div
          className={`rounded-xl border p-3 space-y-1.5 text-[11px] ${
            result.signingSucceeded && result.localVerificationPassed
              ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200"
              : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/50 text-red-800 dark:text-red-200"
          }`}
        >
          <div className="flex items-center gap-1.5 font-semibold">
            {result.signingSucceeded ? (
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>
              Signing: {result.signingSucceeded ? "Succeeded" : "Failed"}
            </span>
          </div>

          <div className="flex items-center gap-1.5 font-semibold">
            {result.localVerificationPassed ? (
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>
              Local signature verification:{" "}
              {result.localVerificationPassed ? "Passed" : "Failed"}
            </span>
          </div>

          {result.localVerificationPassed && result.verifiedPublicKey && (
            <div className="font-mono break-all opacity-90">
              Verified key matches: {result.verifiedPublicKey}
            </div>
          )}

          {result.error && (
            <div className="break-words text-red-700 dark:text-red-300">
              {result.error}
            </div>
          )}
        </div>
      )}
    </aside>
  );
};

export default DevPrivySigningTestPanel;
