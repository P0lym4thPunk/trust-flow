import React, { useState } from "react";
import {
  ShieldCheck,
  CheckCircle2,
  Clock,
  ArrowRight,
  AlertCircle,
  ExternalLink,
  Lock,
  Send,
  User,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { AgreementRecord } from "../types/agreement";
import { formatAddress, STELLAR_TESTNET_CONFIG } from "../lib/stellar/config";
import { WalletAccount } from "../lib/stellar/wallet";

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
  const [fulfilmentInput, setFulfilmentInput] = useState("");
  const [submittingFulfilment, setSubmittingFulfilment] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showTechDetails, setShowTechDetails] = useState(false);

  // 4 clear, plain language stages
  const steps = [
    { id: "CREATED", label: "Terms agreed" },
    { id: "FUNDED", label: "Money secured" },
    { id: "FULFILMENT_SUBMITTED", label: "Work submitted" },
    { id: "RELEASED", label: "Payment released" },
  ];

  // Helper to get active step index
  const getStepIndex = () => {
    if (agreement.status === "RELEASED") return 3;
    if (agreement.status === "APPROVED" || agreement.status === "FULFILMENT_SUBMITTED") return 2;
    if (agreement.status === "FUNDED") return 1;
    return agreement.payerAccepted && agreement.recipientAccepted ? 1 : 0;
  };

  const currentStepIndex = getStepIndex();

  // Participant Roles
  const isPayer = currentAccount.address === agreement.terms.payer;
  const isRecipient = currentAccount.address === agreement.terms.recipient;
  const isApprover = currentAccount.address === agreement.terms.approver;

  // 1. Recipient Acceptance Handler
  const handleAcceptAgreement = async () => {
    setActionLoading(true);
    setStatusMessage("Recording your acceptance of these terms...");
    setTimeout(() => {
      const updated: AgreementRecord = {
        ...agreement,
        recipientAccepted: true,
        updatedAt: new Date().toISOString(),
        activity: [
          ...agreement.activity,
          {
            id: `act-${Date.now()}`,
            agreementId: agreement.id,
            timestamp: new Date().toISOString(),
            actor: currentAccount.address,
            actorRole: "RECIPIENT",
            type: "ACCEPTED",
            title: "Accepted by recipient",
            description: `Recipient ${formatAddress(currentAccount.address)} accepted the payment terms.`,
          },
        ],
      };
      onUpdateAgreement(updated);
      setActionLoading(false);
      setStatusMessage("Acceptance recorded. Awaiting payer to add money.");
    }, 900);
  };

  // 2. Payer Add Money Handler
  const handleFundEscrow = async () => {
    setActionLoading(true);
    setStatusMessage("Securing payment funds in protected account...");
    setTimeout(() => {
      const txHash = `tf-tx-${Math.random().toString(16).slice(2, 10)}${Math.random().toString(16).slice(2, 10)}`;
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
            title: "Payment secured",
            description: `${agreement.terms.amount} ${agreement.terms.asset} deposited into protected payment account.`,
            txHash,
          },
        ],
      };
      onUpdateAgreement(updated);
      setActionLoading(false);
      setStatusMessage("Funds secured. Recipient can now complete and submit work.");
    }, 1100);
  };

  // 3. Recipient Work Submission Handler
  const handleSubmitFulfilment = async () => {
    if (!fulfilmentInput.trim()) return;
    setSubmittingFulfilment(true);
    setStatusMessage("Submitting work deliverables for review...");
    setTimeout(() => {
      const updated: AgreementRecord = {
        ...agreement,
        status: "FULFILMENT_SUBMITTED",
        fulfilmentNotes: fulfilmentInput,
        fulfilmentHash: `sub-${Math.random().toString(16).slice(2, 14)}`,
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
            description: fulfilmentInput,
          },
        ],
      };
      onUpdateAgreement(updated);
      setSubmittingFulfilment(false);
      setStatusMessage("Work submitted. Awaiting review and approval.");
    }, 900);
  };

  // 4. Approver Review & Approval Handler
  const handleApproveCondition = async () => {
    setActionLoading(true);
    setStatusMessage("Confirming condition satisfaction...");
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
      setStatusMessage("Work approved. Funds are unlocked for release.");
    }, 900);
  };

  // 5. Release Funds Handler
  const handleReleaseFunds = async () => {
    setActionLoading(true);
    setStatusMessage("Releasing payment to recipient...");
    setTimeout(() => {
      const txHash = `tf-rel-${Math.random().toString(16).slice(2, 10)}${Math.random().toString(16).slice(2, 10)}`;
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
            title: "Payment released to recipient",
            description: `${agreement.terms.amount} ${agreement.terms.asset} paid to recipient.`,
            txHash,
          },
        ],
      };
      onUpdateAgreement(updated);
      setActionLoading(false);
      setStatusMessage("Payment complete! All funds have moved.");
    }, 1100);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-150">
      {/* Top Bar with Back Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <button
            onClick={onBack}
            className="text-xs font-semibold text-slate-500 hover:text-slate-900 dark:hover:text-white mb-2 flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to payments
          </button>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-black text-slate-950 dark:text-white font-display">
              {agreement.title}
            </h1>
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              {agreement.status === "RELEASED"
                ? "Completed"
                : agreement.status === "FUNDED"
                ? "Money secured"
                : agreement.status === "FULFILMENT_SUBMITTED"
                ? "Under review"
                : "Awaiting start"}
            </span>
          </div>
        </div>

        {/* Amount Header with Reference Style Highlight */}
        <div className="text-left sm:text-right">
          <div className="text-2xl sm:text-3xl font-black font-display text-slate-950 dark:text-white tabular-nums stat-highlight">
            {agreement.terms?.amount || "0.00"}
          </div>
          <span className="text-xs font-bold text-slate-500 ml-1.5 uppercase">
            {agreement.terms?.asset || "USDC"}
          </span>
        </div>
      </div>

      {/* Progress Indicator (4 Clear Stages) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs">
        <div className="flex items-center justify-between gap-2 overflow-x-auto py-1">
          {steps.map((s, idx) => {
            const isCompleted = currentStepIndex > idx || (idx === 0 && agreement.recipientAccepted);
            const isCurrent = currentStepIndex === idx;

            return (
              <div key={s.id} className="flex items-center gap-2 shrink-0">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    isCompleted || (idx === 3 && agreement.status === "RELEASED")
                      ? "bg-[#F5D03A] text-slate-950 font-black"
                      : isCurrent
                      ? "border-2 border-[#F5D03A] text-[#F5D03A]"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-400"
                  }`}
                >
                  {isCompleted || (idx === 3 && agreement.status === "RELEASED") ? (
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  ) : (
                    idx + 1
                  )}
                </div>
                <span
                  className={`text-xs ${
                    isCurrent
                      ? "font-bold text-slate-950 dark:text-white"
                      : isCompleted
                      ? "text-slate-700 dark:text-slate-300 font-medium"
                      : "text-slate-400"
                  }`}
                >
                  {s.label}
                </span>
                {idx < steps.length - 1 && (
                  <div className="w-6 sm:w-10 h-0.5 bg-slate-200 dark:bg-slate-800 mx-1" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Status Feedback Notice */}
      {statusMessage && (
        <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/40 text-xs text-[#4A2574] dark:text-purple-300 flex items-center gap-2">
          <Clock className="w-4 h-4 text-[#F5D03A] shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Prominent Next Required Action Card */}
      <div className="bg-[#121824] text-white border-2 border-dashed border-[#F5D03A]/70 rounded-2xl p-6 shadow-md space-y-4">
        <div className="flex items-center justify-between border-b border-slate-700/60 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-[#F5D03A] text-slate-950 flex items-center justify-center font-bold text-xs">
              !
            </div>
            <h3 className="font-bold text-sm text-white uppercase tracking-wider">
              Next Required Action
            </h3>
          </div>
          <span className="text-xs text-slate-400">
            Current account: <strong className="text-[#F5D03A]">{currentAccount.displayName}</strong>
          </span>
        </div>

        {/* Stage 1A: Recipient Acceptance Pending */}
        {agreement.status === "CREATED" && !agreement.recipientAccepted && (
          <div className="space-y-3">
            <div>
              <h4 className="font-bold text-sm text-white">
                Awaiting Recipient Review & Acceptance
              </h4>
              <p className="text-xs text-slate-300 mt-0.5">
                The person receiving payment must review and accept the agreed terms before money can be added.
              </p>
            </div>

            {isRecipient ? (
              <button
                onClick={handleAcceptAgreement}
                disabled={actionLoading}
                className="px-5 py-2.5 text-xs font-bold text-slate-950 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-lg shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                Accept agreement terms
                <Check className="w-3.5 h-3.5" />
              </button>
            ) : (
              <div className="text-xs text-slate-400 italic">
                Waiting for recipient ({formatAddress(agreement.terms.recipient)}) to accept.
              </div>
            )}
          </div>
        )}

        {/* Stage 1B: Payer Needs to Add Money */}
        {agreement.status === "CREATED" && agreement.recipientAccepted && (
          <div className="space-y-3">
            <div>
              <h4 className="font-bold text-sm text-white">
                Terms Accepted by Both Parties · Ready to Secure Payment
              </h4>
              <p className="text-xs text-slate-300 mt-0.5">
                Payer adds the agreed {agreement.terms.amount} {agreement.terms.asset}. Funds will be held in protected storage until work is verified.
              </p>
            </div>

            {isPayer ? (
              <button
                onClick={handleFundEscrow}
                disabled={actionLoading}
                className="px-5 py-2.5 text-xs font-bold text-slate-950 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-lg shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                Add {agreement.terms.amount} {agreement.terms.asset} to secure payment
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <div className="text-xs text-slate-400 italic">
                Waiting for payer ({formatAddress(agreement.terms.payer)}) to add funds.
              </div>
            )}
          </div>
        )}

        {/* Stage 2: Recipient Work Submission Pending */}
        {agreement.status === "FUNDED" && (
          <div className="space-y-3">
            <div>
              <h4 className="font-bold text-sm text-white">
                Money Secured · Recipient is Working
              </h4>
              <p className="text-xs text-slate-300 mt-0.5">
                The agreed payment is safely reserved. Recipient submits completed deliverables when finished.
              </p>
            </div>

            {isRecipient ? (
              <div className="space-y-2 pt-1">
                <textarea
                  rows={2}
                  value={fulfilmentInput}
                  onChange={(e) => setFulfilmentInput(e.target.value)}
                  placeholder="Provide delivery notes, project link, or completion summary..."
                  className="w-full text-xs p-2.5 rounded-lg bg-slate-900 border border-slate-700 text-white placeholder:text-slate-500"
                />
                <button
                  onClick={handleSubmitFulfilment}
                  disabled={submittingFulfilment || !fulfilmentInput.trim()}
                  className="px-4 py-2 text-xs font-bold text-slate-950 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-lg shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  Submit completed work
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="text-xs text-slate-400 italic">
                Recipient ({formatAddress(agreement.terms.recipient)}) is preparing the deliverables.
              </div>
            )}
          </div>
        )}

        {/* Stage 3: Approver Review & Approval */}
        {agreement.status === "FULFILMENT_SUBMITTED" && (
          <div className="space-y-3">
            <div>
              <h4 className="font-bold text-sm text-white">
                Work Submitted · Ready for Review
              </h4>
              <div className="text-xs text-slate-300 mt-1 p-3 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-slate-400 block mb-0.5 font-bold">Submission notes:</span>
                "{agreement.fulfilmentNotes || "Work deliverables submitted for inspection."}"
              </div>
            </div>

            {isApprover ? (
              <button
                onClick={handleApproveCondition}
                disabled={actionLoading}
                className="px-5 py-2.5 text-xs font-bold text-slate-950 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-lg shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                Approve work & unlock release
                <Check className="w-3.5 h-3.5" />
              </button>
            ) : (
              <div className="text-xs text-slate-400 italic">
                Waiting for reviewer ({formatAddress(agreement.terms.approver)}) to confirm satisfaction.
              </div>
            )}
          </div>
        )}

        {/* Stage 4: Release Payment */}
        {agreement.status === "APPROVED" && (
          <div className="space-y-3">
            <div>
              <h4 className="font-bold text-sm text-white">
                Condition Satisfied · Ready to Release Payment
              </h4>
              <p className="text-xs text-slate-300 mt-0.5">
                The agreed condition has been verified. Anyone may now trigger the final payment transfer to {formatAddress(agreement.terms.recipient)}.
              </p>
            </div>

            <button
              onClick={handleReleaseFunds}
              disabled={actionLoading}
              className="px-5 py-2.5 text-xs font-bold text-slate-950 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-lg shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              Release {agreement.terms.amount} {agreement.terms.asset} now
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Stage 5: Payment Completed */}
        {agreement.status === "RELEASED" && (
          <div className="flex items-center gap-3 py-1">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-sm text-white">
                Payment Completed & Released
              </h4>
              <p className="text-xs text-slate-300">
                All conditions were satisfied. Funds have been sent directly to the recipient.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Participants & Terms Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Participants */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 text-xs space-y-3 shadow-xs">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Participants
          </div>

          <div className="space-y-2.5">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 flex items-center justify-between">
              <div>
                <span className="font-bold text-slate-900 dark:text-white block">
                  Person paying (Client)
                </span>
                <span className="text-[11px] font-mono text-slate-500">
                  {formatAddress(agreement.terms?.payer || "")}
                </span>
              </div>
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                Accepted
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 flex items-center justify-between">
              <div>
                <span className="font-bold text-slate-900 dark:text-white block">
                  Person receiving payment (Contractor)
                </span>
                <span className="text-[11px] font-mono text-slate-500">
                  {formatAddress(agreement.terms?.recipient || "")}
                </span>
              </div>
              <span
                className={`text-[10px] font-bold ${
                  agreement.recipientAccepted
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-amber-500"
                }`}
              >
                {agreement.recipientAccepted ? "Accepted" : "Pending"}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 flex items-center justify-between">
              <div>
                <span className="font-bold text-slate-900 dark:text-white block">
                  Person approving (Reviewer)
                </span>
                <span className="text-[11px] font-mono text-slate-500">
                  {formatAddress(agreement.terms?.approver || "")}
                </span>
              </div>
              <span className="text-[10px] font-bold text-slate-500">
                Authorized
              </span>
            </div>
          </div>
        </div>

        {/* Agreed Terms */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 text-xs space-y-3 shadow-xs">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Agreed terms & condition
          </div>

          <div className="space-y-2.5">
            <div>
              <span className="font-bold text-slate-500 block mb-0.5">Release condition:</span>
              <p className="text-slate-800 dark:text-slate-200 leading-relaxed">
                {agreement.terms?.condition || "Approval required upon completion"}
              </p>
            </div>

            <div>
              <span className="font-bold text-slate-500 block mb-0.5">Work stages / Deliverables:</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {(agreement.terms?.deliverables || ["Milestone deliverables"]).map((item, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[11px] text-slate-700 dark:text-slate-300"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <span className="font-bold text-slate-500 block mb-0.5">Due date:</span>
              <span className="font-mono text-slate-700 dark:text-slate-300">
                {agreement.terms?.deadline
                  ? new Date(agreement.terms.deadline).toLocaleDateString([], {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })
                  : "Standard timeline"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Activity Timeline */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 text-xs space-y-3 shadow-xs">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
          Payment activity timeline
        </div>

        <div className="space-y-2">
          {agreement.activity.map((event) => (
            <div
              key={event.id}
              className="p-3 rounded-xl border border-slate-100 dark:border-slate-800/80 flex items-start justify-between gap-3"
            >
              <div>
                <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <span>{event.title}</span>
                  <span className="text-[10px] text-slate-400 font-normal">
                    · {event.actorRole.toLowerCase()}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {event.description}
                </div>
              </div>
              <span className="text-[10px] text-slate-400 font-mono shrink-0">
                {new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Collapsible Technical & Verification Details */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
        <button
          onClick={() => setShowTechDetails(!showTechDetails)}
          className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 text-left text-xs font-bold text-slate-600 dark:text-slate-400 flex items-center justify-between cursor-pointer"
        >
          <span>Technical & verification reference (Advanced)</span>
          {showTechDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showTechDetails && (
          <div className="p-4 bg-white dark:bg-slate-900 text-xs font-mono space-y-2 text-slate-600 dark:text-slate-400 border-t border-slate-200 dark:border-slate-800">
            <div>
              <span className="text-slate-400">Payment agreement reference:</span>{" "}
              <span className="text-slate-900 dark:text-white break-all">{agreement.canonicalHash}</span>
            </div>
            <div>
              <span className="text-slate-400">Protected escrow ID:</span> #{agreement.escrowId || 1}
            </div>
            <div>
              <span className="text-slate-400">Network:</span> Stellar Testnet
            </div>
            {agreement.fundingTxHash && (
              <div>
                <span className="text-slate-400">Transaction reference:</span>{" "}
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${agreement.fundingTxHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#4A2574] dark:text-[#F5D03A] underline inline-flex items-center gap-1"
                >
                  {agreement.fundingTxHash.slice(0, 20)}...
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
