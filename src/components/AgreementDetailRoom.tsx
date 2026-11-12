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
  FileCheck,
  RefreshCw,
  XCircle,
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

  // Status progression mapping
  const steps = [
    { id: "CREATED", label: "Accepted by Parties" },
    { id: "FUNDED", label: "Escrow Funded" },
    { id: "FULFILMENT_SUBMITTED", label: "Work Submitted" },
    { id: "APPROVED", label: "Approved for Release" },
    { id: "RELEASED", label: "Payment Released" },
  ];

  const currentStepIndex = steps.findIndex((s) => s.id === agreement.status);

  // Participant Role Checks
  const isPayer = currentAccount.address === agreement.terms.payer;
  const isRecipient = currentAccount.address === agreement.terms.recipient;
  const isApprover = currentAccount.address === agreement.terms.approver;

  // 1. Recipient Acceptance Handler
  const handleAcceptAgreement = async () => {
    setActionLoading(true);
    setStatusMessage("Recording on-chain acceptance...");
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
            title: "Accepted by Recipient",
            description: `Recipient ${formatAddress(currentAccount.address)} accepted canonical hash ${agreement.canonicalHash.slice(0, 8)}...`,
          },
        ],
      };
      onUpdateAgreement(updated);
      setActionLoading(false);
      setStatusMessage("Acceptance recorded. Awaiting payer funding.");
    }, 1200);
  };

  // 2. Payer Funding Handler
  const handleFundEscrow = async () => {
    setActionLoading(true);
    setStatusMessage("[Demo Mode] Simulating token lock on Stellar Testnet...");
    setTimeout(() => {
      const txHash = `sim-tx-${Math.random().toString(16).slice(2, 10)}${Math.random().toString(16).slice(2, 10)}`;
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
            title: "Escrow Funded (Demo Simulation)",
            description: `${agreement.terms.amount} ${agreement.terms.asset} simulated lock for demonstration.`,
            txHash,
          },
        ],
      };
      onUpdateAgreement(updated);
      setActionLoading(false);
      setStatusMessage("Escrow funded in demo simulation. Ready for work submission.");
    }, 1500);
  };

  // 3. Recipient Fulfilment Submission Handler
  const handleSubmitFulfilment = async () => {
    if (!fulfilmentInput.trim()) return;
    setSubmittingFulfilment(true);
    setStatusMessage("[Demo Mode] Submitting fulfilment deliverables...");
    setTimeout(() => {
      const updated: AgreementRecord = {
        ...agreement,
        status: "FULFILMENT_SUBMITTED",
        fulfilmentNotes: fulfilmentInput,
        fulfilmentHash: `sim-hash-${Math.random().toString(16).slice(2, 18)}`,
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
            title: "Fulfilment Deliverables Submitted",
            description: fulfilmentInput,
          },
        ],
      };
      onUpdateAgreement(updated);
      setSubmittingFulfilment(false);
      setStatusMessage("Fulfilment submitted in demo simulation. Waiting for approver review.");
    }, 1200);
  };

  // 4. Approver Condition Approval Handler
  const handleApproveCondition = async () => {
    setActionLoading(true);
    setStatusMessage("[Demo Mode] Verifying condition satisfaction...");
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
            title: "Condition Verified & Approved",
            description: "Approver confirmed satisfactory fulfilment of agreed terms.",
          },
        ],
      };
      onUpdateAgreement(updated);
      setActionLoading(false);
      setStatusMessage("Condition approved in demo simulation. Funds unlocked for release.");
    }, 1200);
  };

  // 5. Release Funds Handler (Permissionless once approved)
  const handleReleaseFunds = async () => {
    setActionLoading(true);
    setStatusMessage("[Demo Mode] Simulating release of escrowed tokens to recipient...");
    setTimeout(() => {
      const txHash = `sim-rel-${Math.random().toString(16).slice(2, 10)}${Math.random().toString(16).slice(2, 10)}`;
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
            title: "Funds Transferred to Recipient",
            description: `${agreement.terms.amount} ${agreement.terms.asset} released to ${formatAddress(agreement.terms.recipient)}.`,
            txHash,
          },
        ],
      };
      onUpdateAgreement(updated);
      setActionLoading(false);
      setStatusMessage("Payment released successfully!");
    }, 1500);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Top Back Nav & Title Header */}
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <button
            onClick={onBack}
            className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white mb-1 flex items-center gap-1 cursor-pointer"
          >
            ← Back to Agreements
          </button>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black text-slate-900 dark:text-white">
              {agreement.title}
            </h2>
            <span className="text-xs px-2 py-0.5 rounded font-bold bg-[#F5D03A]/20 text-slate-900 dark:text-[#F5D03A]">
              {agreement.status.replace("_", " ")}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-2xl font-black tabular-nums text-slate-900 dark:text-white">
              {agreement.terms.amount} <span className="text-sm font-bold text-slate-500">{agreement.terms.asset}</span>
            </div>
            <div className="text-[10px] text-slate-400">
              Escrow ID: #{agreement.escrowId || 1}
            </div>
          </div>
        </div>
      </div>

      {/* Visual Status Tracker Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2 overflow-x-auto py-2">
          {steps.map((step, idx) => {
            const isCompleted = currentStepIndex >= idx;
            const isCurrent = currentStepIndex === idx;

            return (
              <div key={step.id} className="flex items-center gap-2 shrink-0">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    isCompleted
                      ? "bg-[#F5D03A] text-slate-950 font-black shadow-xs"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-400"
                  }`}
                >
                  {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
                </div>
                <span
                  className={`text-xs ${
                    isCurrent
                      ? "font-bold text-slate-900 dark:text-white"
                      : isCompleted
                      ? "text-slate-700 dark:text-slate-300 font-medium"
                      : "text-slate-400"
                  }`}
                >
                  {step.label}
                </span>
                {idx < steps.length - 1 && (
                  <div className="w-6 h-0.5 bg-slate-200 dark:bg-slate-800 mx-1" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Status Feedback Message */}
      {statusMessage && (
        <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/40 text-xs text-[#4A2574] dark:text-purple-300 flex items-center gap-2">
          <Clock className="w-4 h-4 text-[#F5D03A] shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Action Decision Center (Role-Specific) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
            <Lock className="w-4 h-4 text-[#F5D03A]" />
            Next Required Action
          </h3>
          <span className="text-xs text-slate-500">
            Viewing as: <strong>{currentAccount.displayName}</strong>
          </span>
        </div>

        {/* Action 1: Recipient Acceptance Pending */}
        {agreement.status === "CREATED" && !agreement.recipientAccepted && (
          <div className="flex items-center justify-between p-4 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40">
            <div>
              <div className="font-bold text-xs text-slate-900 dark:text-white">
                Awaiting Recipient Acceptance
              </div>
              <div className="text-[11px] text-slate-500">
                Bob (Recipient) must review and record acceptance on-chain before funding is unlocked.
              </div>
            </div>
            {isRecipient ? (
              <button
                onClick={handleAcceptAgreement}
                disabled={actionLoading}
                className="px-4 py-2 text-xs font-bold text-slate-900 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-lg shadow-xs cursor-pointer"
              >
                Accept Terms On-Chain
              </button>
            ) : (
              <span className="text-xs text-slate-400 italic">Waiting for Bob</span>
            )}
          </div>
        )}

        {/* Action 2: Payer Funding Pending */}
        {agreement.status === "CREATED" && agreement.recipientAccepted && (
          <div className="flex items-center justify-between p-4 rounded-xl bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/40">
            <div>
              <div className="font-bold text-xs text-slate-900 dark:text-white">
                Dual Acceptance Verified · Ready for Funding
              </div>
              <div className="text-[11px] text-slate-500">
                Payer {formatAddress(agreement.terms.payer)} must authorize token deposit into Soroban Escrow.
              </div>
            </div>
            {isPayer ? (
              <button
                onClick={handleFundEscrow}
                disabled={actionLoading}
                className="px-4 py-2 text-xs font-bold text-slate-900 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-lg shadow-xs cursor-pointer"
              >
                Fund {agreement.terms.amount} {agreement.terms.asset}
              </button>
            ) : (
              <span className="text-xs text-slate-400 italic">Waiting for Alice to fund</span>
            )}
          </div>
        )}

        {/* Action 3: Recipient Fulfilment Submission Pending */}
        {agreement.status === "FUNDED" && (
          <div className="space-y-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800">
            <div>
              <div className="font-bold text-xs text-slate-900 dark:text-white">
                Tokens Locked in Escrow · Awaiting Work Submission
              </div>
              <div className="text-[11px] text-slate-500">
                Recipient {formatAddress(agreement.terms.recipient)} must submit completion evidence.
              </div>
            </div>

            {isRecipient ? (
              <div className="space-y-2 pt-2">
                <textarea
                  rows={2}
                  value={fulfilmentInput}
                  onChange={(e) => setFulfilmentInput(e.target.value)}
                  placeholder="Provide delivery notes, Github PR link, or Figma link..."
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                />
                <button
                  onClick={handleSubmitFulfilment}
                  disabled={submittingFulfilment || !fulfilmentInput.trim()}
                  className="px-4 py-2 text-xs font-bold text-slate-900 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-lg shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  Submit Fulfilment Deliverables
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="text-xs text-slate-400 italic">
                Awaiting Bob's deliverable submission.
              </div>
            )}
          </div>
        )}

        {/* Action 4: Approver Review & Verification Pending */}
        {agreement.status === "FULFILMENT_SUBMITTED" && (
          <div className="p-4 rounded-xl bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/40 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-bold text-xs text-slate-900 dark:text-white">
                  Deliverables Ready for Approver Review
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
                  Submitted notes: <em>"{agreement.fulfilmentNotes || "Work deliverables submitted"}"</em>
                </div>
              </div>
            </div>

            {isApprover ? (
              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={handleApproveCondition}
                  disabled={actionLoading}
                  className="px-4 py-2 text-xs font-bold text-slate-900 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-lg shadow-xs cursor-pointer"
                >
                  Approve Deliverables
                </button>
              </div>
            ) : (
              <div className="text-xs text-slate-400 italic">
                Waiting for Approver ({formatAddress(agreement.terms.approver)}) to review.
              </div>
            )}
          </div>
        )}

        {/* Action 5: Permissionless Release Pending */}
        {agreement.status === "APPROVED" && (
          <div className="flex items-center justify-between p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40">
            <div>
              <div className="font-bold text-xs text-slate-900 dark:text-white">
                Condition Approved! Ready for Release
              </div>
              <div className="text-[11px] text-slate-500">
                Permissionless release callable by any participant. Tokens will be paid to {formatAddress(agreement.terms.recipient)}.
              </div>
            </div>
            <button
              onClick={handleReleaseFunds}
              disabled={actionLoading}
              className="px-4 py-2 text-xs font-bold text-slate-900 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-lg shadow-xs cursor-pointer flex items-center gap-1.5"
            >
              Release Funds
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Terminal State: Released */}
        {agreement.status === "RELEASED" && (
          <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0" />
            <div>
              <div className="font-bold text-xs text-emerald-900 dark:text-emerald-300">
                Payment Completed & Released
              </div>
              <div className="text-[11px] text-slate-500">
                All conditions met. Funds transferred on Stellar Testnet.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Participants & Terms Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Participants Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 text-xs space-y-3">
          <span className="font-bold text-slate-400 uppercase tracking-wider block text-[10px]">
            Agreement Participants
          </span>

          <div className="space-y-2">
            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-950/50">
              <div>
                <span className="font-bold block">Payer (Client)</span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {agreement.terms.payer}
                </span>
              </div>
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">Accepted</span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-950/50">
              <div>
                <span className="font-bold block">Recipient (Designer / Contractor)</span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {agreement.terms.recipient}
                </span>
              </div>
              <span className={`text-[10px] font-bold ${agreement.recipientAccepted ? "text-emerald-600 dark:text-emerald-400" : "text-amber-500"}`}>
                {agreement.recipientAccepted ? "Accepted" : "Pending"}
              </span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-950/50">
              <div>
                <span className="font-bold block">Designated Approver</span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {agreement.terms.approver}
                </span>
              </div>
              <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400">Authorized</span>
            </div>
          </div>
        </div>

        {/* Agreement Conditions Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 text-xs space-y-3">
          <span className="font-bold text-slate-400 uppercase tracking-wider block text-[10px]">
            Agreed Terms & Conditions
          </span>

          <div className="space-y-2">
            <div>
              <span className="font-bold text-slate-400 block mb-0.5">Condition:</span>
              <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                {agreement.terms.condition}
              </p>
            </div>

            <div>
              <span className="font-bold text-slate-400 block mb-0.5">Cancellation Policy:</span>
              <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                {agreement.terms.cancellationTerms}
              </p>
            </div>

            <div>
              <span className="font-bold text-slate-400 block mb-0.5">Deadline:</span>
              <span className="font-mono text-slate-700 dark:text-slate-300">
                {new Date(agreement.terms.deadline).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Activity Timeline */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 text-xs space-y-3">
        <span className="font-bold text-slate-400 uppercase tracking-wider block text-[10px]">
          On-Chain Activity Timeline
        </span>

        <div className="space-y-2">
          {agreement.activity.map((event) => (
            <div
              key={event.id}
              className="p-2.5 rounded-lg border border-slate-100 dark:border-slate-800 flex items-start justify-between gap-2"
            >
              <div>
                <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <span>{event.title}</span>
                  <span className="text-[10px] text-slate-400 font-normal">
                    by {formatAddress(event.actor)} ({event.actorRole})
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

      {/* Expandable Technical Details */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowTechDetails(!showTechDetails)}
          className="w-full px-4 py-2.5 bg-slate-100 dark:bg-slate-950 text-left text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center justify-between cursor-pointer"
        >
          <span>Advanced Soroban Technical Details</span>
          <span>{showTechDetails ? "−" : "+"}</span>
        </button>

        {showTechDetails && (
          <div className="p-4 bg-white dark:bg-slate-900 text-xs font-mono space-y-2 text-slate-600 dark:text-slate-400">
            <div>
              <span className="text-slate-400">Canonical SHA-256 Hash:</span>{" "}
              <span className="text-slate-900 dark:text-white break-all">{agreement.canonicalHash}</span>
            </div>
            <div>
              <span className="text-slate-400">Contract ID:</span>{" "}
              <span className="break-all">{agreement.terms.contractId}</span>
            </div>
            <div>
              <span className="text-slate-400">Network Passphrase:</span> {STELLAR_TESTNET_CONFIG.networkPassphrase}
            </div>
            <div>
              <span className="text-slate-400">RPC Endpoint:</span> {STELLAR_TESTNET_CONFIG.rpcUrl}
            </div>
            {agreement.fundingTxHash && (
              <div>
                <span className="text-slate-400">Funding TX:</span>{" "}
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${agreement.fundingTxHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#4A2574] dark:text-[#F5D03A] underline inline-flex items-center gap-1"
                >
                  {agreement.fundingTxHash.slice(0, 16)}...
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
