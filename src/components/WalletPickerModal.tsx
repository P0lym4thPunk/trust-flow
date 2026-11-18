import React, { useEffect, useState } from "react";
import {
  X,
  Wallet,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ShieldCheck,
  ArrowLeft,
} from "lucide-react";
import type { UserWalletRecord } from "../lib/auth/privyLifecycle";
import {
  detectAvailableStellarWallets,
  connectStellarWalletProvider,
  signSep53MessageWithProvider,
  type StellarWalletAdapter,
  type StellarWalletProviderId,
  type StellarWalletProviderStatus,
} from "../lib/stellar/walletsKit";

export interface ExternalWalletChallengeData {
  challengeId: string;
  address: string;
  provider: string;
  domain: string;
  network: string;
  expiresAt: string;
  message: string;
}

interface WalletPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRequestChallenge: (address: string, provider: string) => Promise<ExternalWalletChallengeData>;
  onCompleteVerification: (params: {
    challengeId: string;
    address: string;
    signature: string;
  }) => Promise<UserWalletRecord>;
  onVerified?: (wallet: UserWalletRecord) => void;
  walletAdapter?: StellarWalletAdapter;
}

type PickerPhase = "select" | "confirm_sign";

export const WalletPickerModal: React.FC<WalletPickerModalProps> = ({
  isOpen,
  onClose,
  onRequestChallenge,
  onCompleteVerification,
  onVerified,
  walletAdapter,
}) => {
  const [providers, setProviders] = useState<StellarWalletProviderStatus[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [phase, setPhase] = useState<PickerPhase>("select");
  const [busyProviderId, setBusyProviderId] = useState<StellarWalletProviderId | null>(null);
  const [signingBusy, setSigningBusy] = useState(false);
  const [pendingConnection, setPendingConnection] = useState<{
    providerId: StellarWalletProviderId;
    providerName: string;
    challenge: ExternalWalletChallengeData;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setPhase("select");
    setBusyProviderId(null);
    setSigningBusy(false);
    setPendingConnection(null);
    setErrorMessage(null);

    let cancelled = false;
    setLoadingProviders(true);
    void detectAvailableStellarWallets(walletAdapter)
      .then((detected) => {
        if (!cancelled) {
          setProviders(detected);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingProviders(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, walletAdapter]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !signingBusy && !busyProviderId) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose, signingBusy, busyProviderId]);

  if (!isOpen) return null;

  const handleSelectProvider = async (provider: StellarWalletProviderStatus) => {
    if (!provider.sep53SignMessage || !provider.configured || busyProviderId) return;

    setErrorMessage(null);
    setBusyProviderId(provider.id);
    try {
      const connected = await connectStellarWalletProvider(provider.id, walletAdapter);
      const challenge = await onRequestChallenge(connected.address, provider.id);
      setPendingConnection({
        providerId: provider.id,
        providerName: connected.providerName,
        challenge,
      });
      setPhase("confirm_sign");
    } catch (err: any) {
      setErrorMessage(err?.message || `Could not connect ${provider.name}.`);
    } finally {
      setBusyProviderId(null);
    }
  };

  const handleSignOwnershipMessage = async () => {
    if (!pendingConnection || signingBusy) return;
    setErrorMessage(null);
    setSigningBusy(true);
    try {
      const { signature } = await signSep53MessageWithProvider(
        pendingConnection.providerId,
        {
          address: pendingConnection.challenge.address,
          message: pendingConnection.challenge.message,
        },
        walletAdapter
      );

      const linkedWallet = await onCompleteVerification({
        challengeId: pendingConnection.challenge.challengeId,
        address: pendingConnection.challenge.address,
        signature,
      });

      onVerified?.(linkedWallet);
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || "SEP-53 ownership signing failed or was cancelled.");
    } finally {
      setSigningBusy(false);
    }
  };

  const handleCancelPending = () => {
    if (signingBusy) return;
    setPendingConnection(null);
    setPhase("select");
    setErrorMessage(null);
  };

  const verifiableProviders = providers.filter((p) => p.sep53SignMessage);
  const nonVerifiableProviders = providers.filter((p) => !p.sep53SignMessage);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallet-picker-title"
    >
      <div
        onClick={() => {
          if (!signingBusy && !busyProviderId) onClose();
        }}
        className="fixed inset-0 bg-slate-950/65 backdrop-blur-xs"
      />

      <div className="relative w-full max-w-lg max-h-[90dvh] overflow-y-auto bg-[var(--tf-surface)] border border-[var(--tf-border)] rounded-2xl shadow-2xl p-6 space-y-5 z-10">
        <button
          type="button"
          onClick={onClose}
          disabled={signingBusy || Boolean(busyProviderId)}
          aria-label="Close wallet picker"
          className="absolute top-4 right-4 w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-40"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="pr-8">
          <div className="text-xs font-medium text-[#4A2574] dark:text-[#F5D03A] mb-1">
            External Stellar Wallet
          </div>
          <h2
            id="wallet-picker-title"
            className="text-xl font-display font-bold text-slate-950 dark:text-white"
          >
            {phase === "select" ? "Connect a Stellar Wallet" : "Verify Wallet Ownership (SEP-53)"}
          </h2>
          <p className="text-xs text-[var(--tf-muted)] mt-1 leading-relaxed">
            {phase === "select"
              ? "Choose a Stellar wallet to connect. An address is only linked after you sign TrustFlow's verification message."
              : "Review the message below and approve the SEP-53 signature prompt inside your wallet. This proves key control without moving funds."}
          </p>
        </div>

        {errorMessage && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Failed or cancelled</div>
              <div className="mt-0.5">{errorMessage}</div>
            </div>
          </div>
        )}

        {phase === "select" ? (
          <div className="space-y-4">
            {loadingProviders ? (
              <div className="py-8 flex items-center justify-center gap-2 text-xs text-[var(--tf-muted)]">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Checking available Stellar wallet extensions...</span>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--tf-muted)]">
                    Supported for verified ownership linking
                  </div>
                  <div className="space-y-2">
                    {verifiableProviders.map((provider) => {
                      const isBusy = busyProviderId === provider.id;
                      const isDisabled = !provider.configured || Boolean(busyProviderId);
                      return (
                        <button
                          key={provider.id}
                          type="button"
                          disabled={isDisabled}
                          data-testid={`wallet-provider-${provider.id}`}
                          onClick={() => void handleSelectProvider(provider)}
                          className="w-full p-3.5 rounded-xl border border-[var(--tf-border)] bg-[var(--tf-surface-subtle)] hover:border-[#4A2574] dark:hover:border-[#F5D03A] text-left flex items-center justify-between gap-3 transition-colors cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <Wallet className="w-4 h-4 text-[#4A2574] dark:text-[#F5D03A] shrink-0" />
                              <span className="text-sm font-semibold text-slate-950 dark:text-white">
                                {provider.name}
                              </span>
                            </div>
                            <p className="text-[11px] text-[var(--tf-muted)] mt-1 leading-snug">
                              {provider.shortNote}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 text-[11px] font-medium px-2 py-1 rounded-lg ${
                              provider.available
                                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                : "bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                            }`}
                          >
                            {isBusy ? "Connecting..." : provider.statusLabel}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {nonVerifiableProviders.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-[var(--tf-border)]">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--tf-muted)]">
                      Unavailable for verified linking
                    </div>
                    <div className="space-y-2">
                      {nonVerifiableProviders.map((provider) => (
                        <div
                          key={provider.id}
                          data-testid={`wallet-provider-${provider.id}`}
                          aria-disabled="true"
                          className="p-3 rounded-xl border border-[var(--tf-border)] bg-[var(--tf-surface-subtle)]/50 opacity-75 space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                              {provider.name}
                            </span>
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-800 dark:text-amber-300">
                              {provider.statusLabel}
                            </span>
                          </div>
                          <p className="text-[11px] text-[var(--tf-muted)] leading-snug">
                            {provider.unsupportedReason}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          pendingConnection && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-[var(--tf-surface-subtle)] border border-[var(--tf-border)] space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {pendingConnection.providerName}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-800 dark:text-amber-300">
                    <ShieldCheck className="w-3 h-3" />
                    Pending verification
                  </span>
                </div>
                <div className="font-mono text-xs text-slate-950 dark:text-white break-all">
                  {pendingConnection.challenge.address}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--tf-muted)] block">
                  Ownership message to sign (SEP-53)
                </label>
                <pre
                  data-testid="sep53-challenge-message"
                  className="p-3 rounded-xl bg-slate-900/5 dark:bg-slate-950/60 border border-[var(--tf-border)] text-[11px] font-mono text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words leading-relaxed"
                >
                  {pendingConnection.challenge.message}
                </pre>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  disabled={signingBusy}
                  onClick={handleCancelPending}
                  className="inline-flex items-center gap-1.5 px-3.5 min-h-[40px] text-xs font-medium text-[var(--tf-muted)] hover:text-slate-950 dark:hover:text-white cursor-pointer disabled:opacity-50"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Choose different wallet</span>
                </button>

                <button
                  type="button"
                  disabled={signingBusy}
                  data-testid="confirm-sep53-sign-btn"
                  onClick={() => void handleSignOwnershipMessage()}
                  className="inline-flex items-center gap-2 px-4 min-h-[42px] text-xs font-semibold text-slate-950 bg-[#F5D03A] hover:bg-[#E7BF24] rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                >
                  {signingBusy ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Waiting for signature...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Sign ownership message</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
};
