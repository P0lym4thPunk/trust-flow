import React, { useState } from "react";
import { Send, Sparkles, AlertCircle, ArrowRight, ShieldCheck, CheckCircle, FileText } from "lucide-react";
import { AgreementTerms, CheckerAuditResult, TransactionType } from "../types/agreement";
import { STELLAR_TESTNET_CONFIG, toStroopUnits } from "../lib/stellar/config";
import { computeAgreementHash } from "../lib/hash";

interface ConversationalWorkspaceProps {
  initialType?: TransactionType;
  currentUserAddress: string;
  onAgreementCreated: (agreement: any) => void;
}

export const ConversationalWorkspace: React.FC<ConversationalWorkspaceProps> = ({
  initialType = "WORK",
  currentUserAddress,
  onAgreementCreated,
}) => {
  const [selectedType, setSelectedType] = useState<TransactionType>(initialType);
  const [promptInput, setPromptInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [clarification, setClarification] = useState<string | null>(null);
  const [draftTerms, setDraftTerms] = useState<AgreementTerms | null>(null);
  const [checkerAudit, setCheckerAudit] = useState<CheckerAuditResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Example starter prompt templates
  const starterPrompts = [
    {
      type: "WORK" as TransactionType,
      label: "Freelance Web Design",
      text: "Hire Bob to redesign my company website for 500 USDC. Deliverables are Figma files and responsive React code due in 7 days. I will review and approve.",
    },
    {
      type: "PROTECTED_PAYMENT" as TransactionType,
      label: "Custom Physical Item",
      text: "Buy a custom leather messenger bag from Bob for 200 XLM. Bob will ship in 5 days with tracking, and I will confirm upon inspection.",
    },
    {
      type: "CONDITIONAL_DISBURSEMENT" as TransactionType,
      label: "Open-Source Bounty",
      text: "Award 1000 USDC grant to Bob for implementing Stellar SAC token integration in our SDK. Charlie is the designated technical reviewer.",
    },
  ];

  // Call Server-Side Gemini API for Agreement Drafting
  const handleGenerateDraft = async (overridePrompt?: string) => {
    const textToSend = overridePrompt || promptInput;
    if (!textToSend.trim()) return;

    setLoading(true);
    setErrorMessage(null);
    setClarification(null);

    try {
      const response = await fetch("/api/ai/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: textToSend,
          transactionType: selectedType,
          userRole: "PAYER",
        }),
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.result === "CLARIFICATION_REQUIRED") {
        setClarification(data.clarificationQuestion || "Could you specify the missing details?");
        setDraftTerms(null);
      } else if (data.result === "DRAFT_READY") {
        const terms: AgreementTerms = {
          amount: data.amount || "100.00",
          asset: data.asset || "USDC",
          payer: currentUserAddress,
          recipient: "GAAR5B2K36EPLI6T37J6Z4AK7C5N7T7K7K7K7K7K7K7K7K7K7K7K7K7K", // Bob's testnet address default
          approver: currentUserAddress, // Payer approves in standard work escrow
          title: data.title || "Contract Agreement",
          description: data.description || textToSend,
          deliverables: data.deliverables || ["Approved milestones"],
          condition: data.condition || "Payer approves submitted deliverables",
          cancellationTerms: data.cancellationTerms || "Mutual cancellation or timeout refund after deadline",
          deadline: new Date(Date.now() + 86400000 * (data.deadlineDays || 7)).toISOString(),
          contractId: STELLAR_TESTNET_CONFIG.contractId,
          domain: STELLAR_TESTNET_CONFIG.domainSeparator,
          network: STELLAR_TESTNET_CONFIG.network,
          version: 1,
        };

        setDraftTerms(terms);
        setClarification(null);
        // Automatically run checker audit
        runAgreementChecker(terms);
      } else {
        setErrorMessage("Request could not be processed into an agreement draft. Please rephrase.");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to reach AI Assistant server endpoint.");
    } finally {
      setLoading(false);
    }
  };

  // Call Server-Side Gemini API for Agreement Checker
  const runAgreementChecker = async (terms: AgreementTerms) => {
    setChecking(true);
    try {
      const response = await fetch("/api/ai/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terms }),
      });
      if (response.ok) {
        const audit = await response.json();
        setCheckerAudit(audit);
      }
    } catch (err) {
      console.error("Failed to run agreement check:", err);
    } finally {
      setChecking(false);
    }
  };

  // Finalize and save the agreement draft to storage
  const handleFinalizeAgreement = async () => {
    if (!draftTerms) return;

    try {
      // Validate amount format and bounds
      toStroopUnits(draftTerms.amount);

      // Compute canonical RFC 8785 SHA-256 hash
      const canonicalHash = await computeAgreementHash(draftTerms);

      const agreementRecord = {
        id: `agr-${Date.now()}`,
        transactionType: selectedType,
        title: draftTerms.title,
        description: draftTerms.description,
        terms: draftTerms,
        canonicalHash,
        version: draftTerms.version,
        status: "CREATED",
        cancelRequest: "NONE",
        payerAccepted: true, // Initiating payer accepts version 1
        recipientAccepted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        activity: [
          {
            id: `act-${Date.now()}`,
            agreementId: `agr-${Date.now()}`,
            timestamp: new Date().toISOString(),
            actor: currentUserAddress,
            actorRole: "PAYER",
            type: "CREATED",
            title: "Agreement Created & Accepted by Payer",
            description: `Draft terms initialized with canonical hash ${canonicalHash.slice(0, 8)}...`,
          },
        ],
      };

      const res = await fetch("/api/agreements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(agreementRecord),
      });

      if (res.ok) {
        onAgreementCreated(agreementRecord);
      }
    } catch (err: any) {
      setErrorMessage(`Validation error: ${err.message}`);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header Greeting */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-4 h-4 text-[#F5D03A]" />
          <h2 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            TrustFlow Assistant Workspace
          </h2>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Describe what you want to achieve. TrustFlow turns your plain words into a secure, verifiable smart agreement.
        </p>
      </div>

      {/* Transaction Type Selection Segmented Buttons */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-200/60 dark:bg-slate-800/60 rounded-xl w-fit">
        <button
          onClick={() => setSelectedType("WORK")}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            selectedType === "WORK"
              ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          }`}
        >
          Work Escrow
        </button>
        <button
          onClick={() => setSelectedType("PROTECTED_PAYMENT")}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            selectedType === "PROTECTED_PAYMENT"
              ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          }`}
        >
          Protected Payment
        </button>
        <button
          onClick={() => setSelectedType("CONDITIONAL_DISBURSEMENT")}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            selectedType === "CONDITIONAL_DISBURSEMENT"
              ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          }`}
        >
          Conditional Grant
        </button>
      </div>

      {/* Starter Prompt Chips */}
      <div className="space-y-1.5">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
          Quick Starters
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {starterPrompts.map((p, idx) => (
            <button
              key={idx}
              onClick={() => {
                setSelectedType(p.type);
                setPromptInput(p.text);
                handleGenerateDraft(p.text);
              }}
              className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-[#F5D03A] text-left transition-all cursor-pointer shadow-2xs group"
            >
              <div className="text-xs font-bold text-slate-900 dark:text-white mb-0.5 group-hover:text-[#4A2574] dark:group-hover:text-[#F5D03A]">
                {p.label}
              </div>
              <div className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                {p.text}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Message Composer Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm space-y-3">
        <textarea
          rows={3}
          value={promptInput}
          onChange={(e) => setPromptInput(e.target.value)}
          placeholder={`Describe your ${selectedType.toLowerCase().replace("_", " ")} terms (e.g. "Hire Bob to build a React dashboard for 500 USDC...")`}
          className="w-full text-xs sm:text-sm bg-transparent border-0 focus:ring-0 p-1 resize-none text-slate-900 dark:text-white placeholder:text-slate-400"
        />

        <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800/80">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Powered by Gemini 3.8 Flash</span>
            <span aria-hidden="true">·</span>
            <span>Zero-pill plain prose</span>
          </div>

          <button
            onClick={() => handleGenerateDraft()}
            disabled={loading || !promptInput.trim()}
            className="px-4 py-2 text-xs font-bold text-slate-900 bg-[#F5D03A] hover:bg-[#E5BF24] disabled:opacity-40 disabled:cursor-not-allowed rounded-lg shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
          >
            {loading ? "Drafting..." : "Generate Agreement"}
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Error Message */}
      {errorMessage && (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 flex items-start gap-2 text-xs text-red-700 dark:text-red-300">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Clarification Request */}
      {clarification && (
        <div className="p-4 rounded-xl bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/40 space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-[#4A2574] dark:text-purple-300">
            <Sparkles className="w-4 h-4 text-[#F5D03A]" />
            <span>Clarification Needed</span>
          </div>
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
            {clarification}
          </p>
        </div>
      )}

      {/* Structured Draft Preview Card */}
      {draftTerms && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
          <div className="flex items-start justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
            <div>
              <div className="text-[10px] font-bold tracking-wider text-slate-400 uppercase mb-1">
                Draft Agreement Preview · Version {draftTerms.version}
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                {draftTerms.title}
              </h3>
            </div>

            <div className="text-right">
              <div className="text-2xl font-black tabular-nums text-slate-900 dark:text-white">
                {draftTerms.amount} <span className="text-sm font-bold text-slate-500">{draftTerms.asset}</span>
              </div>
              <div className="text-[10px] text-slate-400">
                Escrow Asset: Stellar SAC
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <span className="font-bold text-slate-400 block mb-1">Deliverables</span>
              <ul className="space-y-1 text-slate-700 dark:text-slate-300 list-disc list-inside">
                {draftTerms.deliverables.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>

            <div>
              <span className="font-bold text-slate-400 block mb-1">Release Condition</span>
              <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                {draftTerms.condition}
              </p>
            </div>
          </div>

          {/* Agreement Checker Audit Result */}
          {checkerAudit && (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
                  <ShieldCheck className="w-4 h-4 text-emerald-500" />
                  <span>Agreement Checker Audit: {checkerAudit.overallStatus}</span>
                </div>
                <span className="text-[10px] text-slate-500">
                  {checkerAudit.findings.length} findings
                </span>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-400">
                {checkerAudit.summary}
              </p>

              {checkerAudit.findings.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-200/60 dark:border-slate-800/60">
                  {checkerAudit.findings.map((f, i) => (
                    <div key={i} className="text-xs p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            f.severity === "BLOCKING"
                              ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                              : f.severity === "WARNING"
                              ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                              : "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300"
                          }`}
                        >
                          {f.severity}
                        </span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200">{f.field}: {f.issue}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mb-1">{f.whyItMatters}</div>
                      <div className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">Suggestion: {f.suggestedRevision}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              onClick={() => runAgreementChecker(draftTerms)}
              disabled={checking}
              className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            >
              {checking ? "Auditing..." : "Re-Check Terms"}
            </button>
            <button
              onClick={handleFinalizeAgreement}
              className="px-5 py-2 text-xs font-bold text-slate-900 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-lg shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
            >
              Accept & Create Agreement
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
