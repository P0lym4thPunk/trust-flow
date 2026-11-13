import React, { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  CheckCircle2,
  Clock,
  ArrowRight,
  ExternalLink,
  Send,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  Loader2,
  AlertTriangle,
  RotateCcw,
  XCircle,
  CalendarClock,
} from "lucide-react";
import { AgreementRecord } from "../types/agreement";
import { formatAddress } from "../lib/stellar/config";
import { WalletAccount } from "../lib/stellar/wallet";
import {
  getAgreementVisualStatus,
  getToneClasses,
  isSimulatedHash,
} from "../lib/agreementStatus";

interface AgreementDetailRoomProps {
  agreement: AgreementRecord;
  currentAccount: WalletAccount;
  onUpdateAgreement: (updated: AgreementRecord) => void;
  onBack: () => void;
}

export const AgreementDetailRoom: React.FC<AgreementDetailRoomProps> = ({
  agreement,
  currentAccount,
  onUpdateAgreement,
  onBack,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const [fulfilmentInput, setFulfilmentInput] = useState("");
  const [submittingFulfilment, setSubmittingFulfilment] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [rejectionInput, setRejectionInput] = useState("");
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showTechDetails, setShowTechDetails] = useState(false);

  const visualStatus = getAgreementVisualStatus(agreement);
  const toneClasses = getToneClasses(visualStatus.tone);

  const steps = [
    { id: "CREATED", label: "Terms agreed" },
    { id: "FUNDED", label: "Funds secured" },
    { id: "FULFILMENT_SUBMITTED", label: "Work submitted" },
    { id: "RELEASED", label: "Payment released" },
  ];

  const isTerminalClosed =
    agreement.status === "REFUNDED" || agreement.status === "CANCELLED";

  const isPreFundingCreated =
    agreement.status === "CREATED" || (agreement.status as string) === "READY_FOR_FUNDING";

  const bothAccepted = Boolean(
    (agreement.payerAccepted && agreement.recipientAccepted) ||
      (agreement.status as string) === "READY_FOR_FUNDING"
  );

  const getStepIndex = () => {
    if (agreement.status === "RELEASED") return 3;
    if (agreement.status === "APPROVED" || agreement.status === "FULFILMENT_SUBMITTED") return 2;
    if (agreement.status === "FUNDED") return 1;
    return bothAccepted ? 1 : 0;
  };

  const currentStepIndex = getStepIndex();

  const isPayer = currentAccount.address === agreement.terms.payer;
  const isRecipient = currentAccount.address === agreement.terms.recipient;
  const isApprover = currentAccount.address === agreement.terms.approver;

  const isFundedStage =
    agreement.status === "FUNDED" ||
    agreement.status === "FULFILMENT_SUBMITTED" ||
    agreement.status === "APPROVED";

  // 1. Counterparty Acceptance Handler (supports both recipient accepting payer's agreement & payer accepting freelancer's request)
  const handleAcceptAgreement = async () => {
    setFormError(null);
    setActionLoading(true);
    setStatusMessage("Recording your acceptance of these terms...");
    const acceptingAsPayer = isPayer && !agreement.payerAccepted;

    setTimeout(() => {
      const updated: AgreementRecord = {
        ...agreement,
        payerAccepted: acceptingAsPayer ? true : agreement.payerAccepted,
        recipientAccepted: !acceptingAsPayer ? true : agreement.recipientAccepted,
        updatedAt: new Date().toISOString(),
        activity: [
          ...agreement.activity,
          {
            id: `act-${Date.now()}`,
            agreementId: agreement.id,
            timestamp: new Date().toISOString(),
            actor: currentAccount.address,
            actorRole: acceptingAsPayer ? "PAYER" : "RECIPIENT",
            type: "ACCEPTED",
            title: acceptingAsPayer ? "Accepted by client" : "Accepted by recipient",
            description: `${acceptingAsPayer ? "Client" : "Recipient"} ${formatAddress(
              currentAccount.address
            )} accepted the agreement terms.`,
          },
        ],
      };
      onUpdateAgreement(updated);
      setActionLoading(false);
      setStatusMessage("Terms accepted. Ready for the client to secure funds.");
    }, 650);
  };

  // 2. Payer Add Money Handler (Test Workspace Simulation)
  const handleFundEscrow = async () => {
    setFormError(null);
    setActionLoading(true);
    setStatusMessage("Recording test funding in workspace simulation...");
    setTimeout(() => {
      const txHash = `tf-tx-${Math.random().toString(16).slice(2, 10)}${Math.random()
        .toString(16)
        .slice(2, 10)}`;
      const updated: AgreementRecord = {
        ...agreement,
        status: "FUNDED",
        fundedAt: new Date().toISOString(),
        fundingTxHash: txHash,
        updatedAt: new Date().toISOString(),
        activity: [
          ...agreement.activity,
          {
            id: `act-${Date.now()}`,
            agreementId: agreement.id,
            timestamp: new Date().toISOString(),
            actor: currentAccount.address,
            actorRole: "PAYER",
            type: "FUNDED",
            title: "Funds secured (test simulation)",
            description: `${agreement.terms.amount} ${agreement.terms.asset} marked as funded in test workspace simulation.`,
            txHash,
          },
        ],
      };
      onUpdateAgreement(updated);
      setActionLoading(false);
      setStatusMessage(
        "Marked as funded in test workspace simulation (no real funds moved). Recipient can now submit work."
      );
    }, 750);
  };

  // 3. Recipient Work Submission Handler
  const handleSubmitFulfilment = async () => {
    if (!fulfilmentInput.trim()) {
      setFormError("Please add delivery notes or a link to your completed work before submitting.");
      return;
    }
    setFormError(null);
    setSubmittingFulfilment(true);
    setStatusMessage("Submitting your work for review...");
    setTimeout(() => {
      const updated: AgreementRecord = {
        ...agreement,
        status: "FULFILMENT_SUBMITTED",
        fulfilmentNotes: fulfilmentInput.trim(),
        fulfilmentHash: `sub-${Math.random().toString(16).slice(2, 14)}`,
        rejectionReason: undefined,
        rejectionReasonHash: undefined,
        updatedAt: new Date().toISOString(),
        activity: [
          ...agreement.activity,
          {
            id: `act-${Date.now()}`,
            agreementId: agreement.id,
            timestamp: new Date().toISOString(),
            actor: currentAccount.address,
            actorRole: "RECIPIENT",
            type: "FULFILMENT_SUBMITTED",
            title: "Work submitted for review",
            description: fulfilmentInput.trim(),
          },
        ],
      };
      onUpdateAgreement(updated);
      setFulfilmentInput("");
      setSubmittingFulfilment(false);
      setStatusMessage("Work submitted. Waiting for reviewer approval.");
    }, 650);
  };

  // 4A. Approver Review & Approval Handler
  const handleApproveCondition = async () => {
    setFormError(null);
    setActionLoading(true);
    setStatusMessage("Approving the submitted work...");
    setTimeout(() => {
      const updated: AgreementRecord = {
        ...agreement,
        status: "APPROVED",
        updatedAt: new Date().toISOString(),
        activity: [
          ...agreement.activity,
          {
            id: `act-${Date.now()}`,
            agreementId: agreement.id,
            timestamp: new Date().toISOString(),
            actor: currentAccount.address,
            actorRole: "APPROVER",
            type: "APPROVED",
            title: "Work approved",
            description: "Conditions satisfied. Ready to release payment.",
          },
        ],
      };
      onUpdateAgreement(updated);
      setActionLoading(false);
      setStatusMessage("Work approved. Ready for final release.");
    }, 650);
  };

  // 4B. Approver Request Changes / Reject Submitted Work Handler
  const handleRejectSubmission = async () => {
    if (!rejectionInput.trim()) {
      setFormError("Please explain briefly what needs to be revised.");
      return;
    }
    setFormError(null);
    setActionLoading(true);
    setStatusMessage("Sending revision feedback to the recipient...");
    setTimeout(() => {
      const reason = rejectionInput.trim();
      const updated: AgreementRecord = {
        ...agreement,
        status: "FUNDED",
        rejectionReason: reason,
        updatedAt: new Date().toISOString(),
        activity: [
          ...agreement.activity,
          {
            id: `act-${Date.now()}`,
            agreementId: agreement.id,
            timestamp: new Date().toISOString(),
            actor: currentAccount.address,
            actorRole: "APPROVER",
            type: "REJECTED",
            title: "Changes requested",
            description: reason,
          },
        ],
      };
      onUpdateAgreement(updated);
      setRejectionInput("");
      setShowRejectBox(false);
      setActionLoading(false);
      setStatusMessage("Revision request recorded. Funds remain held while work is updated.");
    }, 650);
  };

  // 5. Release Funds Handler (Test Workspace Simulation)
  const handleReleaseFunds = async () => {
    setFormError(null);
    setActionLoading(true);
    setStatusMessage("Recording payment release in test workspace simulation...");
    setTimeout(() => {
      const txHash = `tf-rel-${Math.random().toString(16).slice(2, 10)}${Math.random()
        .toString(16)
        .slice(2, 10)}`;
      const updated: AgreementRecord = {
        ...agreement,
        status: "RELEASED",
        completedAt: new Date().toISOString(),
        releaseTxHash: txHash,
        updatedAt: new Date().toISOString(),
        activity: [
          ...agreement.activity,
          {
            id: `act-${Date.now()}`,
            agreementId: agreement.id,
            timestamp: new Date().toISOString(),
            actor: currentAccount.address,
            actorRole: isPayer ? "PAYER" : isRecipient ? "RECIPIENT" : "APPROVER",
            type: "RELEASED",
            title: "Payment released (test simulation)",
            description: `${agreement.terms.amount} ${agreement.terms.asset} marked as released in test workspace simulation.`,
            txHash,
          },
        ],
      };
      onUpdateAgreement(updated);
      setActionLoading(false);
      setStatusMessage(
        "Recorded as completed in test workspace simulation (no real funds moved)."
      );
    }, 750);
  };

  // 6. Cancellation / Dispute Request Handlers
  const handleRequestCancellation = async () => {
    setFormError(null);
    setActionLoading(true);
    const requestSide = isPayer ? "REQUESTED_BY_PAYER" : "REQUESTED_BY_RECIPIENT";
    setStatusMessage("Recording cancellation request...");
    setTimeout(() => {
      const updated: AgreementRecord = {
        ...agreement,
        cancelRequest: requestSide,
        updatedAt: new Date().toISOString(),
        activity: [
          ...agreement.activity,
          {
            id: `act-${Date.now()}`,
            agreementId: agreement.id,
            timestamp: new Date().toISOString(),
            actor: currentAccount.address,
            actorRole: isPayer ? "PAYER" : "RECIPIENT",
            type: "CANCEL_REQUESTED",
            title: "Cancellation requested",
            description: `${isPayer ? "Client" : "Recipient"} requested mutual cancellation. Funds stay held while unresolved.`,
          },
        ],
      };
      onUpdateAgreement(updated);
      setShowCancelConfirm(false);
      setActionLoading(false);
      setStatusMessage("Cancellation requested. Waiting for the other party to confirm or resolve.");
    }, 550);
  };

  const handleWithdrawCancellation = async () => {
    setFormError(null);
    setActionLoading(true);
    setStatusMessage("Withdrawing cancellation request...");
    setTimeout(() => {
      const updated: AgreementRecord = {
        ...agreement,
        cancelRequest: "NONE",
        updatedAt: new Date().toISOString(),
        activity: [
          ...agreement.activity,
          {
            id: `act-${Date.now()}`,
            agreementId: agreement.id,
            timestamp: new Date().toISOString(),
            actor: currentAccount.address,
            actorRole: isPayer ? "PAYER" : "RECIPIENT",
            type: "CANCEL_CONFIRMED",
            title: "Cancellation request withdrawn",
            description: "Both sides can continue with the agreement.",
          },
        ],
      };
      onUpdateAgreement(updated);
      setActionLoading(false);
      setStatusMessage("Cancellation request withdrawn. Agreement continues.");
    }, 550);
  };

  const handleConfirmCancellation = async () => {
    setFormError(null);
    setActionLoading(true);
    setStatusMessage(
      isFundedStage
        ? "Recording simulated refund to client..."
        : "Cancelling agreement..."
    );
    setTimeout(() => {
      const refHash = isFundedStage
        ? `tf-ref-${Math.random().toString(16).slice(2, 10)}${Math.random()
            .toString(16)
            .slice(2, 10)}`
        : undefined;
      const updated: AgreementRecord = {
        ...agreement,
        status: isFundedStage ? "REFUNDED" : "CANCELLED",
        cancelRequest: "NONE",
        refundTxHash: refHash,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        activity: [
          ...agreement.activity,
          {
            id: `act-${Date.now()}`,
            agreementId: agreement.id,
            timestamp: new Date().toISOString(),
            actor: currentAccount.address,
            actorRole: isPayer ? "PAYER" : "RECIPIENT",
            type: isFundedStage ? "REFUNDED" : "CANCELLED",
            title: isFundedStage
              ? "Refund recorded (test simulation)"
              : "Agreement cancelled",
            description: isFundedStage
              ? "Mutual cancellation confirmed. Refund recorded in test workspace simulation."
              : "Mutual cancellation confirmed before funding.",
            txHash: refHash,
          },
        ],
      };
      onUpdateAgreement(updated);
      setActionLoading(false);
      setStatusMessage(
        isFundedStage
          ? "Mutual cancellation confirmed. Refund recorded in test simulation."
          : "Agreement cancelled."
      );
    }, 650);
  };

  const canCurrentUserAccept =
    agreement.status === "CREATED" &&
    ((isRecipient && !agreement.recipientAccepted) ||
      (isPayer && !agreement.payerAccepted));

  const isRequestedByCurrentUser =
    (agreement.cancelRequest === "REQUESTED_BY_PAYER" && isPayer) ||
    (agreement.cancelRequest === "REQUESTED_BY_RECIPIENT" && isRecipient);

  const isRequestedByOtherParty =
    (agreement.cancelRequest === "REQUESTED_BY_PAYER" && isRecipient) ||
    (agreement.cancelRequest === "REQUESTED_BY_RECIPIENT" && isPayer);

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="max-w-4xl mx-auto space-y-5"
    >
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-4 border-b border-[var(--tf-border)]">
        <div className="space-y-1.5 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="text-xs font-medium text-[var(--tf-muted)] hover:text-slate-950 dark:hover:text-white inline-flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to payments</span>
          </button>

          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display font-bold text-xl sm:text-2xl text-slate-950 dark:text-white break-words">
              {agreement.title}
            </h1>
            <span className={`text-xs font-medium inline-flex items-center gap-1 ${toneClasses.text}`}>
              <span>·</span>
              {visualStatus.key === "released" ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : visualStatus.key === "work_rejected" || visualStatus.key === "dispute_cancel" ? (
                <AlertTriangle className="w-3.5 h-3.5" />
              ) : visualStatus.key === "refunded" ? (
                <RotateCcw className="w-3.5 h-3.5" />
              ) : visualStatus.key === "cancelled" ? (
                <XCircle className="w-3.5 h-3.5" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5" />
              )}
              <span>{visualStatus.label}</span>
            </span>
          </div>

          <p className="text-xs text-[var(--tf-muted)]">{visualStatus.summary}</p>
        </div>

        <div className="text-left sm:text-right shrink-0">
          <div className="text-2xl sm:text-3xl font-display font-bold text-slate-950 dark:text-white tabular-nums">
            {agreement.terms?.amount || "0.00"}{" "}
            <span className="text-xs font-medium text-[var(--tf-muted)]">
              {agreement.terms?.asset || "USDC"}
            </span>
          </div>
          {visualStatus.isSimulatedTx && (
            <span className="text-[11px] text-[var(--tf-muted)] block mt-0.5">
              Test workspace simulation
            </span>
          )}
        </div>
      </div>

      {/* Progress Tracker (only when agreement is not closed via cancel/refund) */}
      {!isTerminalClosed && (
        <div className="bg-[var(--tf-surface)] border border-[var(--tf-border)] rounded-2xl p-4 sm:p-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {steps.map((s, idx) => {
              const isCompleted =
                currentStepIndex > idx ||
                (idx === 0 && bothAccepted) ||
                (idx === 3 && agreement.status === "RELEASED");
              const isCurrent = currentStepIndex === idx && agreement.status !== "RELEASED";

              return (
                <div key={s.id} className="flex items-center gap-2.5">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 transition-colors ${
                      isCompleted
                        ? "bg-[#F5D03A] text-slate-950"
                        : isCurrent
                        ? "border-2 border-[#4A2574] dark:border-[#F5D03A] text-[#4A2574] dark:text-[#F5D03A]"
                        : "bg-[var(--tf-surface-subtle)] text-[var(--tf-muted)]"
                    }`}
                  >
                    {isCompleted ? <Check className="w-3.5 h-3.5 stroke-[2.5]" /> : idx + 1}
                  </div>
                  <span
                    className={`text-xs ${
                      isCurrent
                        ? "font-semibold text-slate-950 dark:text-white"
                        : isCompleted
                        ? "font-medium text-slate-700 dark:text-slate-300"
                        : "text-[var(--tf-muted)]"
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Deadline Passed Notice (strictly informational — no automatic movement) */}
      {visualStatus.isDeadlinePassed && (
        <div className="px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
          <CalendarClock className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            The target due date has passed. Funds do <strong>not</strong> move automatically at
            deadlines—complete review, adjust delivery with your counterparty, or use mutual
            cancellation below.
          </span>
        </div>
      )}

      {/* Cancellation / Dispute Requested Banner */}
      {agreement.cancelRequest && agreement.cancelRequest !== "NONE" && !isTerminalClosed && (
        <div className="p-4 sm:p-5 rounded-2xl bg-rose-500/8 border border-rose-500/25 space-y-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <h3 className="font-semibold text-slate-950 dark:text-white">
                Cancellation requested by{" "}
                {agreement.cancelRequest === "REQUESTED_BY_PAYER" ? "client" : "recipient"}
              </h3>
              <p className="text-[var(--tf-muted)] leading-relaxed">
                Funds stay held while unresolved. TrustFlow&apos;s AI helper cannot decide
                disputes or move funds automatically—both parties must agree or await future
                human dispute resolution.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pl-6">
            {isRequestedByOtherParty && (
              <button
                type="button"
                onClick={handleConfirmCancellation}
                disabled={actionLoading}
                className="px-4 min-h-[38px] text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
              >
                {isFundedStage ? "Confirm cancellation & record refund" : "Confirm cancellation"}
              </button>
            )}
            {isRequestedByCurrentUser && (
              <button
                type="button"
                onClick={handleWithdrawCancellation}
                disabled={actionLoading}
                className="px-4 min-h-[38px] text-xs font-semibold text-slate-900 dark:text-white bg-[var(--tf-surface)] border border-[var(--tf-border)] hover:bg-[var(--tf-surface-subtle)] rounded-xl transition-colors cursor-pointer disabled:opacity-50"
              >
                Withdraw cancellation request
              </button>
            )}
          </div>
        </div>
      )}

      {/* Inline Status Notice & Form Errors */}
      {statusMessage && (
        <div className="px-4 py-3 rounded-xl bg-[var(--tf-surface-subtle)] border border-[var(--tf-border)] text-xs text-slate-800 dark:text-slate-200 flex items-center gap-2">
          <Clock className="w-4 h-4 text-[#4A2574] dark:text-[#F5D03A] shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {formError && (
        <div className="px-4 py-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{formError}</span>
        </div>
      )}

      {/* Next Required Action Surface */}
      <div className="bg-[var(--tf-surface)] border border-[var(--tf-border)] rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--tf-border)]">
          <h2 className="font-display font-semibold text-sm text-slate-950 dark:text-white">
            {isTerminalClosed || agreement.status === "RELEASED" ? "Final outcome" : "Next step"}
          </h2>
          <span className="text-xs text-[var(--tf-muted)]">
            Viewing as{" "}
            <strong className="text-slate-900 dark:text-white font-medium">
              {currentAccount.displayName}
            </strong>
          </span>
        </div>

        {/* Stage 0: DRAFT */}
        {agreement.status === "DRAFT" && (
          <div className="space-y-1.5">
            <h3 className="font-semibold text-sm text-slate-950 dark:text-white">
              Draft agreement
            </h3>
            <p className="text-xs text-[var(--tf-muted)] leading-relaxed">
              This draft has not been finalized or funded yet.
            </p>
          </div>
        )}

        {/* Stage 1A: Counterparty Acceptance Pending */}
        {isPreFundingCreated && !bothAccepted && (
          <div className="space-y-3">
            <div>
              <h3 className="font-semibold text-sm text-slate-950 dark:text-white">
                {!agreement.payerAccepted && !agreement.recipientAccepted
                  ? "Waiting for both parties to accept terms"
                  : !agreement.payerAccepted
                  ? "Waiting for client to accept payment request"
                  : "Waiting for recipient to accept terms"}
              </h3>
              <p className="text-xs text-[var(--tf-muted)] mt-1 leading-relaxed">
                Both the person paying and the person receiving payment must confirm these terms
                before funds are added.
              </p>
            </div>

            {canCurrentUserAccept ? (
              <button
                type="button"
                onClick={handleAcceptAgreement}
                disabled={actionLoading}
                className="px-5 min-h-[42px] text-xs font-semibold text-slate-950 bg-[#F5D03A] hover:bg-[#E7BF24] rounded-xl transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {actionLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                <span>
                  {isPayer && !agreement.payerAccepted
                    ? "Accept payment request"
                    : "Accept agreement terms"}
                </span>
              </button>
            ) : (
              <p className="text-xs text-[var(--tf-muted)]">
                Waiting for{" "}
                {!agreement.payerAccepted
                  ? `client (${formatAddress(agreement.terms.payer)})`
                  : `recipient (${formatAddress(agreement.terms.recipient)})`}{" "}
                to accept.
              </p>
            )}
          </div>
        )}

        {/* Stage 1B: Payer Needs to Add Money */}
        {isPreFundingCreated && bothAccepted && (
          <div className="space-y-3">
            <div>
              <h3 className="font-semibold text-sm text-slate-950 dark:text-white">
                Terms agreed · Ready for funding
              </h3>
              <p className="text-xs text-[var(--tf-muted)] mt-1 leading-relaxed">
                Secure {agreement.terms.amount} {agreement.terms.asset} under the agreed terms so
                work can begin.
              </p>
            </div>

            {isPayer ? (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleFundEscrow}
                  disabled={actionLoading}
                  className="px-5 min-h-[42px] text-xs font-semibold text-slate-950 bg-[#F5D03A] hover:bg-[#E7BF24] rounded-xl transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {actionLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ArrowRight className="w-3.5 h-3.5" />
                  )}
                  <span>
                    Fund {agreement.terms.amount} {agreement.terms.asset}
                  </span>
                </button>
                <p className="text-[11px] text-[var(--tf-muted)]">
                  Test workspace simulation — marks this agreement funded without moving real
                  money.
                </p>
              </div>
            ) : (
              <p className="text-xs text-[var(--tf-muted)]">
                Waiting for client ({formatAddress(agreement.terms.payer)}) to fund the agreement.
              </p>
            )}
          </div>
        )}

        {/* Stage 2: Recipient Work Submission Pending (or Revision Requested) */}
        {agreement.status === "FUNDED" && (
          <div className="space-y-3">
            {agreement.rejectionReason && (
              <div className="p-3.5 rounded-xl bg-rose-500/8 border border-rose-500/25 space-y-1 text-xs">
                <div className="font-semibold text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Changes requested by reviewer</span>
                </div>
                <p className="text-slate-800 dark:text-slate-200 leading-relaxed">
                  {agreement.rejectionReason}
                </p>
                <p className="text-[11px] text-[var(--tf-muted)]">
                  Funds remain held safely while the updated work is prepared.
                </p>
              </div>
            )}

            <div>
              <h3 className="font-semibold text-sm text-slate-950 dark:text-white">
                {agreement.rejectionReason
                  ? "Submit revised work"
                  : "Funds secured · Work in progress"}
              </h3>
              <p className="text-xs text-[var(--tf-muted)] mt-1 leading-relaxed">
                {agreement.rejectionReason
                  ? "Share the updated delivery link or revision notes for review."
                  : "Funds are held while work is underway. Submit your delivery notes or link when complete."}
              </p>
            </div>

            {isRecipient ? (
              <div className="space-y-2.5 pt-1">
                <textarea
                  rows={2}
                  value={fulfilmentInput}
                  onChange={(e) => {
                    setFulfilmentInput(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  placeholder="Share delivery notes or a link to the finished work..."
                  className="w-full text-xs sm:text-sm p-3 rounded-xl bg-[var(--tf-surface-subtle)] border border-[var(--tf-border)] text-slate-950 dark:text-white placeholder:text-[var(--tf-muted)] focus:outline-none focus:border-[#4A2574] dark:focus:border-[#F5D03A]"
                />
                <button
                  type="button"
                  onClick={handleSubmitFulfilment}
                  disabled={submittingFulfilment}
                  className="px-4 min-h-[42px] text-xs font-semibold text-slate-950 bg-[#F5D03A] hover:bg-[#E7BF24] disabled:opacity-50 rounded-xl transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {submittingFulfilment ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {agreement.rejectionReason ? "Resubmit work" : "Submit completed work"}
                  </span>
                </button>
              </div>
            ) : (
              <p className="text-xs text-[var(--tf-muted)]">
                Waiting for {formatAddress(agreement.terms.recipient)} to submit the completed work.
              </p>
            )}
          </div>
        )}

        {/* Stage 3: Approver Review & Approval / Request Changes */}
        {agreement.status === "FULFILMENT_SUBMITTED" && (
          <div className="space-y-3">
            <div>
              <h3 className="font-semibold text-sm text-slate-950 dark:text-white">
                Work submitted · Awaiting review
              </h3>
              <div className="text-xs text-slate-800 dark:text-slate-200 mt-2 p-3.5 rounded-xl bg-[var(--tf-surface-subtle)] border border-[var(--tf-border)]">
                <span className="text-[var(--tf-muted)] block mb-1">Delivery note</span>
                {agreement.fulfilmentNotes || "Work submitted for review."}
              </div>
            </div>

            {isApprover ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleApproveCondition}
                    disabled={actionLoading}
                    className="px-5 min-h-[42px] text-xs font-semibold text-slate-950 bg-[#F5D03A] hover:bg-[#E7BF24] rounded-xl transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {actionLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                    <span>Approve work</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowRejectBox((prev) => !prev);
                      setFormError(null);
                    }}
                    className="px-4 min-h-[42px] text-xs font-medium text-slate-700 dark:text-slate-200 bg-[var(--tf-surface-subtle)] hover:bg-slate-200/70 dark:hover:bg-slate-800 border border-[var(--tf-border)] rounded-xl transition-colors cursor-pointer"
                  >
                    {showRejectBox ? "Cancel revision" : "Request changes"}
                  </button>
                </div>

                {showRejectBox && (
                  <div className="p-3.5 rounded-xl bg-[var(--tf-surface-subtle)] border border-[var(--tf-border)] space-y-2.5">
                    <label className="block text-xs font-medium text-slate-900 dark:text-white">
                      What needs to be updated?
                    </label>
                    <textarea
                      rows={2}
                      value={rejectionInput}
                      onChange={(e) => {
                        setRejectionInput(e.target.value);
                        if (formError) setFormError(null);
                      }}
                      placeholder="Explain clearly what does not yet match the agreed terms..."
                      className="w-full text-xs sm:text-sm p-3 rounded-xl bg-[var(--tf-surface)] border border-[var(--tf-border)] text-slate-950 dark:text-white placeholder:text-[var(--tf-muted)] focus:outline-none focus:border-[#4A2574] dark:focus:border-[#F5D03A]"
                    />
                    <button
                      type="button"
                      onClick={handleRejectSubmission}
                      disabled={actionLoading}
                      className="px-4 min-h-[38px] text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                    >
                      Send revision request
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-[var(--tf-muted)]">
                Waiting for reviewer ({formatAddress(agreement.terms.approver)}) to approve or
                request revisions.
              </p>
            )}
          </div>
        )}

        {/* Stage 4: Release Payment */}
        {agreement.status === "APPROVED" && (
          <div className="space-y-3">
            <div>
              <h3 className="font-semibold text-sm text-slate-950 dark:text-white">
                Approved · Release pending
              </h3>
              <p className="text-xs text-[var(--tf-muted)] mt-1 leading-relaxed">
                The work is approved. Complete release of {agreement.terms.amount}{" "}
                {agreement.terms.asset} to {formatAddress(agreement.terms.recipient)}.
              </p>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={handleReleaseFunds}
                disabled={actionLoading}
                className="px-5 min-h-[42px] text-xs font-semibold text-slate-950 bg-[#F5D03A] hover:bg-[#E7BF24] rounded-xl transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {actionLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ArrowRight className="w-3.5 h-3.5" />
                )}
                <span>
                  Release {agreement.terms.amount} {agreement.terms.asset}
                </span>
              </button>
              <p className="text-[11px] text-[var(--tf-muted)]">
                Test workspace simulation — records completion without moving real funds.
              </p>
            </div>
          </div>
        )}

        {/* Stage 5: Payment Released */}
        {agreement.status === "RELEASED" && (
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-slate-950 dark:text-white">
                {visualStatus.isSimulatedTx
                  ? "Payment released (test simulation)"
                  : "Payment released"}
              </h3>
              <p className="text-xs text-[var(--tf-muted)] mt-0.5 leading-relaxed">
                {visualStatus.isSimulatedTx
                  ? "This agreement completed in test workspace simulation. No real money moved on-chain."
                  : "All conditions were met and the payment has been released to the recipient."}
              </p>
            </div>
          </div>
        )}

        {/* Terminal: Refunded */}
        {agreement.status === "REFUNDED" && (
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-[var(--tf-surface-subtle)] text-[var(--tf-muted)] flex items-center justify-center shrink-0">
              <RotateCcw className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-slate-950 dark:text-white">
                {visualStatus.isSimulatedTx ? "Refunded (test simulation)" : "Funds refunded"}
              </h3>
              <p className="text-xs text-[var(--tf-muted)] mt-0.5 leading-relaxed">
                {visualStatus.isSimulatedTx
                  ? "Mutual cancellation was confirmed and recorded as refunded in test workspace simulation."
                  : "Funds were returned to the client."}
              </p>
            </div>
          </div>
        )}

        {/* Terminal: Cancelled */}
        {agreement.status === "CANCELLED" && (
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-[var(--tf-surface-subtle)] text-[var(--tf-muted)] flex items-center justify-center shrink-0">
              <XCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-slate-950 dark:text-white">
                Agreement cancelled
              </h3>
              <p className="text-xs text-[var(--tf-muted)] mt-0.5 leading-relaxed">
                This agreement was closed before payment release.
              </p>
            </div>
          </div>
        )}

        {/* Secondary Cancellation Action for Active Parties */}
        {(isPayer || isRecipient) &&
          !isTerminalClosed &&
          agreement.status !== "RELEASED" &&
          agreement.status !== "DRAFT" &&
          (!agreement.cancelRequest || agreement.cancelRequest === "NONE") && (
            <div className="pt-3 border-t border-[var(--tf-border)]">
              {!showCancelConfirm ? (
                <button
                  type="button"
                  onClick={() => setShowCancelConfirm(true)}
                  className="text-xs font-medium text-[var(--tf-muted)] hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
                >
                  Request cancellation
                </button>
              ) : (
                <div className="p-3.5 rounded-xl bg-[var(--tf-surface-subtle)] border border-[var(--tf-border)] space-y-2.5">
                  <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed">
                    Requesting cancellation flags this agreement so both sides can agree to close
                    or refund. Funds stay held until both sides confirm.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleRequestCancellation}
                      disabled={actionLoading}
                      className="px-3.5 min-h-[36px] text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                    >
                      Confirm request
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCancelConfirm(false)}
                      className="px-3.5 min-h-[36px] text-xs font-medium text-[var(--tf-muted)] hover:text-slate-950 dark:hover:text-white cursor-pointer"
                    >
                      Keep agreement active
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
      </div>

      {/* Grouped Agreement Overview: People Involved & Agreed Terms */}
      <div className="bg-[var(--tf-surface)] border border-[var(--tf-border)] rounded-2xl p-5 sm:p-6 grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
        <div className="space-y-3">
          <h3 className="font-display font-semibold text-sm text-slate-950 dark:text-white">
            People involved
          </h3>

          <div className="divide-y divide-[var(--tf-border)]">
            <div className="py-2.5 first:pt-0 flex items-center justify-between gap-2">
              <div>
                <span className="font-medium text-slate-900 dark:text-white block">
                  Person paying (client)
                </span>
                <span className="text-[11px] font-mono text-[var(--tf-muted)]">
                  {formatAddress(agreement.terms?.payer || "")}
                </span>
              </div>
              <span
                className={`text-[11px] font-medium ${
                  agreement.payerAccepted
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-amber-600 dark:text-amber-400"
                }`}
              >
                {agreement.payerAccepted ? "Agreed" : "Pending"}
              </span>
            </div>

            <div className="py-2.5 flex items-center justify-between gap-2">
              <div>
                <span className="font-medium text-slate-900 dark:text-white block">
                  Person receiving payment
                </span>
                <span className="text-[11px] font-mono text-[var(--tf-muted)]">
                  {formatAddress(agreement.terms?.recipient || "")}
                </span>
              </div>
              <span
                className={`text-[11px] font-medium ${
                  agreement.recipientAccepted
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-amber-600 dark:text-amber-400"
                }`}
              >
                {agreement.recipientAccepted ? "Agreed" : "Pending"}
              </span>
            </div>

            <div className="py-2.5 last:pb-0 flex items-center justify-between gap-2">
              <div>
                <span className="font-medium text-slate-900 dark:text-white block">
                  Person approving
                </span>
                <span className="text-[11px] font-mono text-[var(--tf-muted)]">
                  {formatAddress(agreement.terms?.approver || "")}
                </span>
              </div>
              <span className="text-[11px] text-[var(--tf-muted)]">Reviewer</span>
            </div>
          </div>
        </div>

        <div className="space-y-3 md:border-l md:border-[var(--tf-border)] md:pl-6">
          <h3 className="font-display font-semibold text-sm text-slate-950 dark:text-white">
            Agreed terms
          </h3>

          <div className="space-y-3">
            <div>
              <span className="text-[var(--tf-muted)] block mb-0.5">Release condition</span>
              <p className="text-slate-800 dark:text-slate-200 leading-relaxed">
                {agreement.terms?.condition || "Approval required upon completion"}
              </p>
            </div>

            <div>
              <span className="text-[var(--tf-muted)] block mb-0.5">Deliverables</span>
              <p className="text-slate-800 dark:text-slate-200 leading-relaxed">
                {(agreement.terms?.deliverables || ["Agreed deliverables"]).join(" · ")}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
              <div>
                <span className="text-[var(--tf-muted)] block mb-0.5">Target due date</span>
                <span className="text-slate-800 dark:text-slate-200 tabular-nums">
                  {agreement.terms?.deadline
                    ? new Date(agreement.terms.deadline).toLocaleDateString([], {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })
                    : "Standard timeline"}
                </span>
              </div>
              <div>
                <span className="text-[var(--tf-muted)] block mb-0.5">Platform fee</span>
                <span className="text-slate-800 dark:text-slate-200">1% (paid by funder)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Payment Activity Timeline */}
      <div className="bg-[var(--tf-surface)] border border-[var(--tf-border)] rounded-2xl p-5 text-xs space-y-3">
        <h3 className="font-display font-semibold text-sm text-slate-950 dark:text-white">
          Activity
        </h3>

        <div className="divide-y divide-[var(--tf-border)]">
          {agreement.activity.map((event) => (
            <div
              key={event.id}
              className="py-2.5 first:pt-0 last:pb-0 flex items-start justify-between gap-3"
            >
              <div>
                <div className="font-medium text-slate-900 dark:text-white">
                  {event.title}{" "}
                  <span className="text-[11px] text-[var(--tf-muted)] font-normal">
                    · {event.actorRole.toLowerCase()}
                  </span>
                </div>
                <div className="text-[11px] text-[var(--tf-muted)] mt-0.5">
                  {event.description}
                </div>
              </div>
              <span className="text-[11px] text-[var(--tf-muted)] font-mono shrink-0 tabular-nums">
                {new Date(event.timestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Progressive Disclosure: Verification Reference (Advanced) */}
      <div className="border border-[var(--tf-border)] rounded-2xl overflow-hidden bg-[var(--tf-surface)]">
        <button
          type="button"
          onClick={() => setShowTechDetails(!showTechDetails)}
          className="w-full px-4 py-3 text-left text-xs font-medium text-[var(--tf-muted)] hover:text-slate-950 dark:hover:text-white flex items-center justify-between cursor-pointer transition-colors"
        >
          <span>Payment record &amp; verification details</span>
          {showTechDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showTechDetails && (
          <div className="p-4 text-xs font-mono space-y-2 text-[var(--tf-muted)] border-t border-[var(--tf-border)] bg-[var(--tf-surface-subtle)]">
            <div>
              <span>Agreement hash: </span>
              <span className="text-slate-900 dark:text-white break-all">
                {agreement.canonicalHash}
              </span>
            </div>
            <div>
              <span>Payment ID: </span>
              <span className="text-slate-900 dark:text-white">#{agreement.escrowId || 1}</span>
            </div>
            <div>
              <span>Network: </span>
              <span className="text-slate-900 dark:text-white">Stellar Testnet</span>
            </div>
            {agreement.fundingTxHash && (
              <div>
                <span>Funding reference: </span>
                {isSimulatedHash(agreement.fundingTxHash) ? (
                  <span className="text-slate-900 dark:text-white">
                    {agreement.fundingTxHash} (test simulation — not on-chain)
                  </span>
                ) : (
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${agreement.fundingTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#4A2574] dark:text-[#F5D03A] underline inline-flex items-center gap-1"
                  >
                    {agreement.fundingTxHash.slice(0, 20)}...
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            )}
            {agreement.releaseTxHash && (
              <div>
                <span>Release reference: </span>
                {isSimulatedHash(agreement.releaseTxHash) ? (
                  <span className="text-slate-900 dark:text-white">
                    {agreement.releaseTxHash} (test simulation — not on-chain)
                  </span>
                ) : (
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${agreement.releaseTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#4A2574] dark:text-[#F5D03A] underline inline-flex items-center gap-1"
                  >
                    {agreement.releaseTxHash.slice(0, 20)}...
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            )}
            {agreement.refundTxHash && (
              <div>
                <span>Refund reference: </span>
                {isSimulatedHash(agreement.refundTxHash) ? (
                  <span className="text-slate-900 dark:text-white">
                    {agreement.refundTxHash} (test simulation — not on-chain)
                  </span>
                ) : (
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${agreement.refundTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#4A2574] dark:text-[#F5D03A] underline inline-flex items-center gap-1"
                  >
                    {agreement.refundTxHash.slice(0, 20)}...
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
};
