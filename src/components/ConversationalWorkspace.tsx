import React, { useState } from "react";
import {
  Send,
  Sparkles,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Clock,
  PlusCircle,
  DollarSign,
  ArrowUpRight,
  FileText,
  User,
  Check,
  ChevronRight,
  ArrowLeft,
  Search,
} from "lucide-react";
import { AgreementRecord, AgreementTerms, CheckerAuditResult, TransactionType } from "../types/agreement";
import { STELLAR_TESTNET_CONFIG, toStroopUnits, formatAddress } from "../lib/stellar/config";
import { computeAgreementHash } from "../lib/hash";

interface ConversationalWorkspaceProps {
  initialType?: TransactionType;
  currentUserAddress: string;
  onAgreementCreated: (agreement: AgreementRecord) => void;
  agreements?: AgreementRecord[];
  onSelectAgreement?: (agreement: AgreementRecord) => void;
  onNavigateTab?: (tab: string) => void;
}

export const ConversationalWorkspace: React.FC<ConversationalWorkspaceProps> = ({
  initialType = "WORK",
  currentUserAddress,
  onAgreementCreated,
  agreements = [],
  onSelectAgreement,
  onNavigateTab,
}) => {
  // Mode: "overview" (Central Dashboard) or "guided_creator" (Step-by-step flow)
  const [viewMode, setViewMode] = useState<"overview" | "guided_creator">("overview");

  // Guided Creator State
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [selectedType, setSelectedType] = useState<TransactionType>(initialType);

  // Form Fields
  const [recipientInput, setRecipientInput] = useState("GAAR5B2K36EPLI6T37J6Z4AK7C5N7T7K7K7K7K7K7K7K7K7K7K7K7K7K");
  const [recipientName, setRecipientName] = useState("Bob (Contractor)");
  const [paymentTitle, setPaymentTitle] = useState("Website Redesign & Brand Assets");
  const [paymentDescription, setPaymentDescription] = useState("Design responsive Figma components and export production tokens");
  const [amountInput, setAmountInput] = useState("500.00");
  const [assetChoice, setAssetChoice] = useState<"USDC" | "XLM">("USDC");
  const [deliverablesInput, setDeliverablesInput] = useState("Figma design tokens, Responsive React components, Design preview");
  const [conditionInput, setConditionInput] = useState("Client reviews and explicitly approves submitted design files and code");
  const [deadlineDays, setDeadlineDays] = useState(7);

  // AI Assistant Drafting & Checker
  const [aiPromptInput, setAiPromptInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [clarification, setClarification] = useState<string | null>(null);
  const [checkerAudit, setCheckerAudit] = useState<CheckerAuditResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showAiAssistantBox, setShowAiAssistantBox] = useState(false);

  // Filter out any malformed or incomplete entries
  const validAgreements = agreements.filter((a) => a && a.id && a.title);

  // Derived summaries for "What is happening with my payments?"
  const activePayments = validAgreements.filter(
    (a) => a.status === "FUNDED" || a.status === "FULFILMENT_SUBMITTED" || a.status === "APPROVED"
  );
  const pendingActionPayments = validAgreements.filter(
    (a) =>
      (a.status === "CREATED" && (!a.payerAccepted || !a.recipientAccepted)) ||
      (a.status === "CREATED" && a.payerAccepted && a.recipientAccepted) ||
      a.status === "FULFILMENT_SUBMITTED"
  );
  const completedPayments = validAgreements.filter((a) => a.status === "RELEASED");

  const totalFundsLocked = activePayments.reduce((acc, a) => {
    return acc + parseFloat(a.terms?.amount || "0");
  }, 0);

  // Identify next urgent action
  const nextUrgentPayment = validAgreements.find(
    (a) =>
      a.status === "FULFILMENT_SUBMITTED" ||
      (a.status === "CREATED" && a.payerAccepted && a.recipientAccepted) ||
      (a.status === "CREATED" && !a.recipientAccepted)
  );

  // Starter quick options for Guided Creator
  const quickContacts = [
    { name: "Bob (Freelance Designer)", address: "GAAR5B2K36EPLI6T37J6Z4AK7C5N7T7K7K7K7K7K7K7K7K7K7K7K7K7K" },
    { name: "Charlie (Technical Reviewer)", address: "GCK5B2K36EPLI6T37J6Z4AK7C5N7T7K7K7K7K7K7K7K7K7K7K7K7K7K7" },
  ];

  // Helper to start creator with specific template
  const handleStartCreator = (type: TransactionType) => {
    setSelectedType(type);
    setCurrentStep(1);
    setViewMode("guided_creator");
    setErrorMessage(null);
    setCheckerAudit(null);

    if (type === "WORK") {
      setPaymentTitle("Website Redesign & Brand Assets");
      setPaymentDescription("Design responsive Figma components and export production tokens");
      setAmountInput("500.00");
      setAssetChoice("USDC");
      setDeliverablesInput("Figma design tokens, Responsive React components, Design preview");
      setConditionInput("Client reviews and explicitly approves submitted design files and code");
    } else if (type === "PROTECTED_PAYMENT") {
      setPaymentTitle("Vintage Camera Purchase");
      setPaymentDescription("Olympus OM-1 35mm Film Camera with 50mm f/1.8 Lens");
      setAmountInput("250.00");
      setAssetChoice("USDC");
      setDeliverablesInput("Tracked courier shipment, Physical package delivery");
      setConditionInput("Buyer confirms package arrival and satisfactory mechanical condition");
    } else {
      setPaymentTitle("Developer Grant: SDK Improvements");
      setPaymentDescription("Implement unit tests and documentation for payment integration");
      setAmountInput("1000.00");
      setAssetChoice("USDC");
      setDeliverablesInput("GitHub pull request merged, Test suite passing, Documentation page");
      setConditionInput("Designated reviewer verifies test suite coverage and merges pull request");
    }
  };

  // Call Server-Side Gemini API for Drafting
  const handleAiDraft = async (customPrompt?: string) => {
    const promptToSend = customPrompt || aiPromptInput;
    if (!promptToSend.trim()) return;

    setAiLoading(true);
    setErrorMessage(null);
    setClarification(null);

    try {
      const response = await fetch("/api/ai/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptToSend,
          transactionType: selectedType,
          userRole: "PAYER",
        }),
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json();

      if (data.result === "CLARIFICATION_REQUIRED") {
        setClarification(data.clarificationQuestion || "Could you provide more specific details?");
      } else if (data.result === "DRAFT_READY") {
        if (data.title) setPaymentTitle(data.title);
        if (data.description) setPaymentDescription(data.description);
        if (data.amount) setAmountInput(data.amount);
        if (data.asset) setAssetChoice(data.asset);
        if (data.deliverables) setDeliverablesInput(data.deliverables.join(", "));
        if (data.condition) setConditionInput(data.condition);
        if (data.deadlineDays) setDeadlineDays(data.deadlineDays);

        setViewMode("guided_creator");
        setCurrentStep(5); // Jump directly to Review step
        runCheckerAudit(buildTermsObject());
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to reach AI Assistant.");
    } finally {
      setAiLoading(false);
    }
  };

  // Build Terms Object for audit and persistence
  const buildTermsObject = (): AgreementTerms => {
    const parsedDeliverables = deliverablesInput
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);

    return {
      amount: parseFloat(amountInput || "100").toFixed(2),
      asset: assetChoice,
      payer: currentUserAddress,
      recipient: recipientInput.trim() || "GAAR5B2K36EPLI6T37J6Z4AK7C5N7T7K7K7K7K7K7K7K7K7K7K7K7K7K",
      approver: currentUserAddress,
      title: paymentTitle.trim() || "Payment Agreement",
      description: paymentDescription.trim() || "Work terms and deliverables",
      deliverables: parsedDeliverables.length > 0 ? parsedDeliverables : ["Agreed deliverables"],
      condition: conditionInput.trim() || "Payer reviews and approves completed work",
      cancellationTerms: "Mutual cancellation permitted prior to approval, or timeout refund if past deadline",
      deadline: new Date(Date.now() + 86400000 * deadlineDays).toISOString(),
      contractId: STELLAR_TESTNET_CONFIG.contractId,
      domain: STELLAR_TESTNET_CONFIG.domainSeparator,
      network: STELLAR_TESTNET_CONFIG.network,
      version: 1,
    };
  };

  // Run AI Checker Audit
  const runCheckerAudit = async (terms: AgreementTerms) => {
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

  // Finalize Agreement and Save to Server
  const handleFinalizeAgreement = async () => {
    setErrorMessage(null);
    try {
      const terms = buildTermsObject();
      toStroopUnits(terms.amount);

      // Compute deterministic canonical hash
      const canonicalHash = await computeAgreementHash(terms);

      const newRecord: AgreementRecord = {
        id: `agr-${Date.now()}`,
        transactionType: selectedType,
        title: terms.title,
        description: terms.description,
        terms,
        canonicalHash,
        version: terms.version,
        status: "CREATED",
        cancelRequest: "NONE",
        payerAccepted: true, // Creator auto-accepts initial terms
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
            title: "Payment Agreement Created",
            description: `Terms established with reference ${canonicalHash.slice(0, 8)}...`,
          },
        ],
      };

      const res = await fetch("/api/agreements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newRecord),
      });

      if (res.ok) {
        onAgreementCreated(newRecord);
      } else {
        throw new Error("Server failed to persist agreement.");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to create payment agreement.");
    }
  };

  /* ==============================================================
     VIEW MODE 1: CENTRAL WORKSPACE OVERVIEW
     Answers: What can I do? | What is happening? | What should I do next?
  ============================================================== */
  if (viewMode === "overview") {
    return (
      <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-150">
        {/* Welcome & Promise Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-950 dark:text-white font-display uppercase">
              Payments Workspace
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Money moves when your agreed conditions are met.
            </p>
          </div>

          <button
            onClick={() => handleStartCreator("WORK")}
            className="px-4 py-2.5 text-xs font-bold text-slate-950 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-lg shadow-xs transition-all flex items-center gap-1.5 shrink-0 cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" />
            Create a payment
          </button>
        </div>

        {/* 1. What can I do? Clear primary actions */}
        <section className="space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
            What can I do?
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <button
              onClick={() => handleStartCreator("WORK")}
              className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-[#F5D03A] text-left transition-all shadow-xs group cursor-pointer"
            >
              <div className="w-9 h-9 rounded-lg bg-[#F5D03A]/20 text-slate-950 dark:text-[#F5D03A] flex items-center justify-center font-bold mb-3 group-hover:scale-105 transition-transform">
                <PlusCircle className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1 group-hover:text-[#4A2574] dark:group-hover:text-[#F5D03A]">
                Create a payment
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Hire someone for design, code, or consulting with guaranteed payment.
              </p>
            </button>

            <button
              onClick={() => handleStartCreator("PROTECTED_PAYMENT")}
              className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-[#F5D03A] text-left transition-all shadow-xs group cursor-pointer"
            >
              <div className="w-9 h-9 rounded-lg bg-[#4A2574]/15 text-[#4A2574] dark:text-purple-300 flex items-center justify-center font-bold mb-3 group-hover:scale-105 transition-transform">
                <DollarSign className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1 group-hover:text-[#4A2574] dark:group-hover:text-[#F5D03A]">
                Pay someone
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Make a protected payment for an everyday purchase or booking.
              </p>
            </button>

            <button
              onClick={() => handleStartCreator("CONDITIONAL_DISBURSEMENT")}
              className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-[#F5D03A] text-left transition-all shadow-xs group cursor-pointer"
            >
              <div className="w-9 h-9 rounded-lg bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 flex items-center justify-center font-bold mb-3 group-hover:scale-105 transition-transform">
                <ArrowUpRight className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1 group-hover:text-[#4A2574] dark:group-hover:text-[#F5D03A]">
                Request payment
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Send payment conditions for client sign-off and advance funding.
              </p>
            </button>

            <button
              onClick={() => onNavigateTab && onNavigateTab("all-agreements")}
              className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-[#F5D03A] text-left transition-all shadow-xs group cursor-pointer"
            >
              <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center font-bold mb-3 group-hover:scale-105 transition-transform">
                <FileText className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1 group-hover:text-[#4A2574] dark:group-hover:text-[#F5D03A]">
                View activity
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                See all payment records, verification status, and completed releases.
              </p>
            </button>
          </div>
        </section>

        {/* 2. What should I do next? (Urgent action banner) */}
        <section className="space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
            What should I do next?
          </div>

          {nextUrgentPayment ? (
            <div className="p-5 rounded-2xl bg-[#121824] text-white border-2 border-dashed border-[#F5D03A]/70 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-md">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold bg-[#F5D03A] text-slate-950 uppercase">
                  Action required
                </div>
                <h4 className="text-base font-bold text-white">
                  {nextUrgentPayment.title}
                </h4>
                <p className="text-xs text-slate-300">
                  {nextUrgentPayment.status === "FULFILMENT_SUBMITTED"
                    ? "Work has been submitted for review. Confirm conditions to release payment."
                    : nextUrgentPayment.status === "CREATED" && nextUrgentPayment.recipientAccepted
                    ? "Both parties accepted the terms. Add money to secure the payment."
                    : "Awaiting recipient review and acceptance of terms."}
                </p>
              </div>

              <button
                onClick={() => onSelectAgreement && onSelectAgreement(nextUrgentPayment)}
                className="px-4 py-2.5 text-xs font-bold text-slate-950 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-lg shadow-xs transition-all flex items-center gap-1.5 shrink-0 cursor-pointer self-start sm:self-auto"
              >
                Open payment
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 shadow-xs">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                    All caught up
                  </h4>
                  <p className="text-xs text-slate-500">
                    No urgent actions pending. Ready to start a new protected payment?
                  </p>
                </div>
              </div>

              <button
                onClick={() => handleStartCreator("WORK")}
                className="px-3.5 py-1.5 text-xs font-bold text-slate-900 dark:text-slate-100 hover:text-slate-950 bg-slate-100 dark:bg-slate-800 hover:bg-[#F5D03A] dark:hover:bg-[#F5D03A] dark:hover:text-slate-950 rounded-lg transition-colors cursor-pointer"
              >
                New payment
              </button>
            </div>
          )}
        </section>

        {/* 3. What is happening with my payments? Clean summary */}
        <section className="space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
            What is happening with my payments?
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
              <span className="text-xs font-bold text-slate-500">Active protected payments</span>
              <div className="mt-3">
                <span className="text-3xl font-black font-display text-slate-950 dark:text-white stat-highlight">
                  {activePayments.length}
                </span>
                <p className="text-[11px] text-slate-400 mt-1">Funds currently held securely</p>
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
              <span className="text-xs font-bold text-slate-500">Reserved balance</span>
              <div className="mt-3">
                <span className="text-3xl font-black font-display text-slate-950 dark:text-white stat-highlight">
                  {totalFundsLocked.toFixed(2)}
                </span>
                <span className="text-xs font-bold text-slate-500 ml-1.5">USDC</span>
                <p className="text-[11px] text-slate-400 mt-1">Ready for fulfillment approval</p>
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
              <span className="text-xs font-bold text-slate-500">Completed & released</span>
              <div className="mt-3">
                <span className="text-3xl font-black font-display text-slate-950 dark:text-white stat-highlight">
                  {completedPayments.length}
                </span>
                <p className="text-[11px] text-slate-400 mt-1">Successfully settled payments</p>
              </div>
            </div>
          </div>
        </section>

        {/* Natural Language Assistant Bar (Gemini) */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#F5D03A]" />
              <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                Or describe terms in plain words
              </h3>
            </div>
            <span className="text-[11px] text-slate-400">Powered by Gemini</span>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={aiPromptInput}
              onChange={(e) => setAiPromptInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAiDraft()}
              placeholder='e.g., "Hire Bob to redesign my website for 500 USDC due in 7 days"'
              className="flex-1 px-3.5 py-2.5 text-xs sm:text-sm bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-hidden focus:border-[#F5D03A] text-slate-900 dark:text-white placeholder:text-slate-400"
            />
            <button
              onClick={() => handleAiDraft()}
              disabled={aiLoading || !aiPromptInput.trim()}
              className="px-4 py-2 text-xs font-bold text-slate-950 bg-[#F5D03A] hover:bg-[#E5BF24] disabled:opacity-50 rounded-xl shadow-xs transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              {aiLoading ? "Thinking..." : "Create draft"}
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>

          {clarification && (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{clarification}</span>
            </div>
          )}
        </section>

        {/* Recent Payments List */}
        {agreements.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Recent payments
              </span>
              <button
                onClick={() => onNavigateTab && onNavigateTab("all-agreements")}
                className="text-xs font-bold text-[#4A2574] dark:text-[#F5D03A] hover:underline cursor-pointer"
              >
                View all ({agreements.length})
              </button>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800/80 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
              {validAgreements.slice(0, 3).map((agr) => (
                <div
                  key={agr.id}
                  onClick={() => onSelectAgreement && onSelectAgreement(agr)}
                  className="p-4 flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                        {agr.title}
                      </h4>
                      <span className="text-[10px] font-semibold text-slate-500 uppercase">
                        · {(agr.transactionType || "WORK").replace("_", " ")}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 line-clamp-1">
                      {agr.description || "Payment agreement"}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <div className="text-sm font-black tabular-nums text-slate-900 dark:text-white">
                        {agr.terms?.amount || "0.00"}{" "}
                        <span className="text-xs font-bold text-slate-500">{agr.terms?.asset || "USDC"}</span>
                      </div>
                      <span className="text-[10px] font-bold text-slate-500">
                        {agr.status === "RELEASED" ? "Payment released" : agr.status === "FUNDED" ? "Money secured" : "Awaiting start"}
                      </span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  /* ==============================================================
     VIEW MODE 2: GUIDED STEP-BY-STEP PAYMENT CREATOR
     Steps:
     1. Who are you paying?
     2. What is the payment for?
     3. How much is involved?
     4. What must happen before payment is released?
     5. Review the agreement.
     6. Confirm and continue.
  ============================================================== */
  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in duration-150">
      {/* Top Breadcrumb & Step Navigation */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={() => setViewMode("overview")}
          className="text-xs font-semibold text-slate-500 hover:text-slate-900 dark:hover:text-white flex items-center gap-1.5 cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to workspace
        </button>

        <span className="text-xs font-bold text-slate-500">
          Step {currentStep} of 6
        </span>
      </div>

      {/* Stepper Dots */}
      <div className="flex items-center gap-2">
        {[1, 2, 3, 4, 5, 6].map((stepNum) => (
          <div
            key={stepNum}
            className={`h-1.5 flex-1 rounded-full transition-all ${
              stepNum === currentStep
                ? "bg-[#F5D03A]"
                : stepNum < currentStep
                ? "bg-slate-900 dark:bg-white"
                : "bg-slate-200 dark:bg-slate-800"
            }`}
          />
        ))}
      </div>

      {/* Card Container */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
        {/* Step 1: Who are you paying? */}
        {currentStep === 1 && (
          <div className="space-y-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-[#F5D03A] mb-1">
                Step 1
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-slate-950 dark:text-white font-display">
                Who are you paying?
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                Select a counterparty or enter their payment account address.
              </p>
            </div>

            <div className="space-y-2 pt-2">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Quick contacts
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {quickContacts.map((contact, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setRecipientName(contact.name);
                      setRecipientInput(contact.address);
                    }}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      recipientInput === contact.address
                        ? "border-[#F5D03A] bg-[#F5D03A]/10 text-slate-950 dark:text-white"
                        : "border-slate-200 dark:border-slate-800 hover:border-slate-300 text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <div className="text-xs font-bold">{contact.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                      {contact.address.slice(0, 16)}...
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-2">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Account address (or custom test address)
              </label>
              <input
                type="text"
                value={recipientInput}
                onChange={(e) => setRecipientInput(e.target.value)}
                placeholder="G..."
                className="w-full px-3.5 py-2.5 text-xs sm:text-sm font-mono bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-hidden focus:border-[#F5D03A] text-slate-900 dark:text-white"
              />
            </div>
          </div>
        )}

        {/* Step 2: What is the payment for? */}
        {currentStep === 2 && (
          <div className="space-y-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-[#F5D03A] mb-1">
                Step 2
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-slate-950 dark:text-white font-display">
                What is the payment for?
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                Give your agreement a clear title and description so both sides agree on the scope.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Agreement title
              </label>
              <input
                type="text"
                value={paymentTitle}
                onChange={(e) => setPaymentTitle(e.target.value)}
                placeholder="e.g. Website Redesign & Brand Assets"
                className="w-full px-3.5 py-2.5 text-xs sm:text-sm bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-hidden focus:border-[#F5D03A] text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Description of work or purchase
              </label>
              <textarea
                rows={3}
                value={paymentDescription}
                onChange={(e) => setPaymentDescription(e.target.value)}
                placeholder="Describe what is expected in plain language..."
                className="w-full px-3.5 py-2.5 text-xs sm:text-sm bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-hidden focus:border-[#F5D03A] text-slate-900 dark:text-white"
              />
            </div>
          </div>
        )}

        {/* Step 3: How much is involved? */}
        {currentStep === 3 && (
          <div className="space-y-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-[#F5D03A] mb-1">
                Step 3
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-slate-950 dark:text-white font-display">
                How much is involved?
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                Specify the exact amount that will be held in protected payment.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Amount
                </label>
                <input
                  type="number"
                  step="any"
                  min="0.01"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  placeholder="500.00"
                  className="w-full px-3.5 py-2.5 text-lg font-black font-display bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-hidden focus:border-[#F5D03A] text-slate-900 dark:text-white tabular-nums"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Currency
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAssetChoice("USDC")}
                    className={`flex-1 py-3 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                      assetChoice === "USDC"
                        ? "border-[#F5D03A] bg-[#F5D03A]/10 text-slate-950 dark:text-white"
                        : "border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    USDC
                  </button>
                  <button
                    type="button"
                    onClick={() => setAssetChoice("XLM")}
                    className={`flex-1 py-3 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                      assetChoice === "XLM"
                        ? "border-[#F5D03A] bg-[#F5D03A]/10 text-slate-950 dark:text-white"
                        : "border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    XLM
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-2">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Delivery deadline (days from today)
              </label>
              <div className="flex items-center gap-3">
                {[3, 7, 14, 30].map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setDeadlineDays(days)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                      deadlineDays === days
                        ? "border-[#F5D03A] bg-[#F5D03A]/15 text-slate-950 dark:text-white"
                        : "border-slate-200 dark:border-slate-800 text-slate-500"
                    }`}
                  >
                    {days} days
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 4: What must happen before payment is released? */}
        {currentStep === 4 && (
          <div className="space-y-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-[#F5D03A] mb-1">
                Step 4
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-slate-950 dark:text-white font-display">
                What must happen before payment is released?
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                Define the tangible work stages and the specific release condition.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Work stages or deliverables (comma separated)
              </label>
              <input
                type="text"
                value={deliverablesInput}
                onChange={(e) => setDeliverablesInput(e.target.value)}
                placeholder="Figma source file, Responsive components, Clean code review"
                className="w-full px-3.5 py-2.5 text-xs sm:text-sm bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-hidden focus:border-[#F5D03A] text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Release condition
              </label>
              <textarea
                rows={2}
                value={conditionInput}
                onChange={(e) => setConditionInput(e.target.value)}
                placeholder="Client reviews deliverables and explicitly confirms approval"
                className="w-full px-3.5 py-2.5 text-xs sm:text-sm bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-hidden focus:border-[#F5D03A] text-slate-900 dark:text-white"
              />
            </div>
          </div>
        )}

        {/* Step 5: Review the agreement */}
        {currentStep === 5 && (
          <div className="space-y-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-[#F5D03A] mb-1">
                Step 5
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-slate-950 dark:text-white font-display">
                Review the agreement
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                Review the summary before creating your protected payment.
              </p>
            </div>

            {/* Plain English Summary Box */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200/60 dark:border-slate-800/60">
                <span className="text-slate-500">Payment amount:</span>
                <span className="text-base font-black text-slate-900 dark:text-white tabular-nums">
                  {amountInput} {assetChoice}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block mb-0.5">Agreement title:</span>
                <span className="font-bold text-slate-900 dark:text-white text-sm">
                  {paymentTitle}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block mb-0.5">Person receiving payment:</span>
                <span className="font-mono text-slate-700 dark:text-slate-300">
                  {recipientInput}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block mb-0.5">Release condition:</span>
                <span className="text-slate-800 dark:text-slate-200">
                  {conditionInput}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block mb-0.5">Agreed deliverables:</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {deliverablesInput.split(",").map((d, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px]"
                    >
                      {d.trim()}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* AI Clarity Check Audit */}
            {checkerAudit && (
              <div className="p-3.5 rounded-xl bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/40 text-xs space-y-1.5">
                <div className="flex items-center gap-1.5 font-bold text-[#4A2574] dark:text-purple-300">
                  <Sparkles className="w-4 h-4 text-[#F5D03A]" />
                  <span>Clarity Check: {checkerAudit.overallStatus === "PASS" ? "Clear & complete" : "Suggestions available"}</span>
                </div>
                <p className="text-slate-600 dark:text-slate-400 text-[11px]">
                  {checkerAudit.summary}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Step 6: Confirm and continue */}
        {currentStep === 6 && (
          <div className="space-y-4 text-center py-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-[#F5D03A] text-slate-950 flex items-center justify-center font-bold">
              <Check className="w-8 h-8" />
            </div>

            <div className="space-y-1">
              <h2 className="text-2xl font-black text-slate-950 dark:text-white font-display">
                Ready to create agreement
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 max-w-sm mx-auto">
                Once created, the counterparty will be able to review and confirm. Money will only move when you add funds in the next step.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-left max-w-md mx-auto space-y-1">
              <div><strong>Protected amount:</strong> {amountInput} {assetChoice}</div>
              <div><strong>Condition:</strong> {conditionInput}</div>
              <div><strong>Timeout:</strong> {deadlineDays} days</div>
            </div>
          </div>
        )}

        {/* Error message */}
        {errorMessage && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Navigation Buttons between steps */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800">
          {currentStep > 1 ? (
            <button
              type="button"
              onClick={() => setCurrentStep(currentStep - 1)}
              className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              Previous
            </button>
          ) : (
            <div />
          )}

          {currentStep < 6 ? (
            <button
              type="button"
              onClick={() => {
                if (currentStep === 4) {
                  runCheckerAudit(buildTermsObject());
                }
                setCurrentStep(currentStep + 1);
              }}
              className="px-5 py-2.5 text-xs font-bold text-slate-950 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-lg shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              Continue
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinalizeAgreement}
              className="px-6 py-2.5 text-xs font-bold text-slate-950 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-lg shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              Confirm and create payment
              <Check className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
