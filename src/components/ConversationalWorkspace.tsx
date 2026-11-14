import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  ArrowUp,
  AlertCircle,
  ArrowRight,
  Clock,
  PlusCircle,
  Send,
  ArrowDownLeft,
  Check,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";
import { AgreementRecord, AgreementTerms, CheckerAuditResult, TransactionType } from "../types/agreement";
import { STELLAR_TESTNET_CONFIG, toStroopUnits, validateStellarAddress } from "../lib/stellar/config";
import { computeAgreementHash } from "../lib/hash";
import { getAgreementVisualStatus, getToneClasses } from "../lib/agreementStatus";
import { useAuth } from "../lib/auth/AuthContext";

interface ConversationalWorkspaceProps {
  initialType?: TransactionType;
  currentUserAddress: string;
  currentUserName?: string;
  onAgreementCreated: (agreement: AgreementRecord) => void;
  agreements?: AgreementRecord[];
  onSelectAgreement?: (agreement: AgreementRecord) => void;
  onNavigateTab?: (tab: string) => void;
}

export const ConversationalWorkspace: React.FC<ConversationalWorkspaceProps> = ({
  initialType = "WORK",
  currentUserAddress,
  currentUserName,
  onAgreementCreated,
  agreements = [],
  onSelectAgreement,
  onNavigateTab,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { getAuthHeaders } = useAuth();

  // Mode: "overview" (Conversational starting point) or "guided_creator" (6-step flow)
  const [viewMode, setViewMode] = useState<"overview" | "guided_creator">("overview");

  // Guided Creator State
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [selectedType, setSelectedType] = useState<TransactionType>(initialType);

  // Form Fields
  const [counterpartyInput, setCounterpartyInput] = useState("GAA3NUA7AXVA54TYMPHTHB6UKZ7ZGFJHUIPOFPPU5TDL5KI2BLCBAJNX");
  const [counterpartyName, setCounterpartyName] = useState("Bob (Freelance Designer)");
  const [paymentTitle, setPaymentTitle] = useState("Website Redesign & Brand Assets");
  const [paymentDescription, setPaymentDescription] = useState("Design responsive Figma components and export production tokens");
  const [amountInput, setAmountInput] = useState("500.00");
  const [assetChoice, setAssetChoice] = useState<"USDC" | "XLM">("USDC");
  const [deliverablesInput, setDeliverablesInput] = useState("Figma design tokens, Responsive React components, Design preview");
  const [conditionInput, setConditionInput] = useState("Client reviews and explicitly approves submitted design files and code");
  const [deadlineDays, setDeadlineDays] = useState(7);

  // Unified Composer & Clarity Check
  const [aiPromptInput, setAiPromptInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [clarification, setClarification] = useState<string | null>(null);
  const [checkerAudit, setCheckerAudit] = useState<CheckerAuditResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [submittingAgreement, setSubmittingAgreement] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [stepValidationError, setStepValidationError] = useState<string | null>(null);

  const validAgreements = agreements.filter((a) => a && a.id && a.title);
  const recentAgreements = validAgreements.slice(0, 2);

  // Auto-expand multiline textarea naturally
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [aiPromptInput, viewMode]);

  const firstName = currentUserName
    ? currentUserName.replace(/\s*\(.*?\)\s*/g, "").trim().split(" ")[0]
    : "";

  const isRequestFlow = selectedType === "CONDITIONAL_DISBURSEMENT";
  const isPaySomeoneFlow = selectedType === "PROTECTED_PAYMENT";

  const quickContacts = isRequestFlow
    ? [
        { name: "Alice (Client / Funder)", address: "GC2YDKW52O7MJ62JGPZGQSKWDN6YUHXU3M32QJQ6DFRBATWL6RIHUOP6" },
        { name: "Charlie (Reviewer)", address: "GCEVSPK3KR7BHVHLBXD2IIVZBP5G4P73WBKWSA6ZWBGHB2FE7JDMZKTL" },
      ]
    : [
        { name: "Bob (Freelance Designer)", address: "GAA3NUA7AXVA54TYMPHTHB6UKZ7ZGFJHUIPOFPPU5TDL5KI2BLCBAJNX" },
        { name: "Charlie (Technical Reviewer)", address: "GCEVSPK3KR7BHVHLBXD2IIVZBP5G4P73WBKWSA6ZWBGHB2FE7JDMZKTL" },
      ];

  // Start guided payment creator with specific template
  const handleStartCreator = (type: TransactionType) => {
    setSelectedType(type);
    setCurrentStep(1);
    setViewMode("guided_creator");
    setErrorMessage(null);
    setStepValidationError(null);
    setCheckerAudit(null);

    if (type === "WORK") {
      setCounterpartyName("Bob (Freelance Designer)");
      setCounterpartyInput("GAA3NUA7AXVA54TYMPHTHB6UKZ7ZGFJHUIPOFPPU5TDL5KI2BLCBAJNX");
      setPaymentTitle("Website Redesign & Brand Assets");
      setPaymentDescription("Design responsive Figma components and export production tokens");
      setAmountInput("500.00");
      setAssetChoice("USDC");
      setDeliverablesInput("Figma design tokens, Responsive React components, Design preview");
      setConditionInput("Client reviews and explicitly approves submitted design files and code");
    } else if (type === "PROTECTED_PAYMENT") {
      setCounterpartyName("Bob (Seller / Recipient)");
      setCounterpartyInput("GAA3NUA7AXVA54TYMPHTHB6UKZ7ZGFJHUIPOFPPU5TDL5KI2BLCBAJNX");
      setPaymentTitle("Vintage Camera Purchase");
      setPaymentDescription("Olympus OM-1 35mm Film Camera with 50mm f/1.8 Lens");
      setAmountInput("250.00");
      setAssetChoice("USDC");
      setDeliverablesInput("Tracked courier shipment, Physical package delivery");
      setConditionInput("Buyer confirms package arrival and satisfactory mechanical condition");
    } else {
      setCounterpartyName("Alice (Client / Funder)");
      setCounterpartyInput("GC2YDKW52O7MJ62JGPZGQSKWDN6YUHXU3M32QJQ6DFRBATWL6RIHUOP6");
      setPaymentTitle("Frontend Delivery & Integration");
      setPaymentDescription("Deliver agreed work stages and receive payment on client approval");
      setAmountInput("650.00");
      setAssetChoice("USDC");
      setDeliverablesInput("Completed deliverables, Final preview link");
      setConditionInput("Client reviews and approves the submitted work");
    }
  };

  // Call Server-Side AI Drafting Endpoint (preserved untouched)
  const handleAiDraft = async (customPrompt?: string) => {
    const promptToSend = customPrompt || aiPromptInput;
    if (!promptToSend.trim() || aiLoading) return;

    setAiLoading(true);
    setErrorMessage(null);
    setClarification(null);

    try {
      const response = await fetch("/api/ai/draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          prompt: promptToSend,
          transactionType: selectedType,
          userRole: isRequestFlow ? "RECIPIENT" : "PAYER",
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `Unable to create draft (${response.status}).`);
      }

      if (data.result === "CLARIFICATION_REQUIRED") {
        setClarification(
          data.clarificationQuestion ||
            "Could you share a few more details, such as the amount and what work is covered?"
        );
      } else if (data.result === "DRAFT_READY") {
        const nextTitle = data.title || paymentTitle;
        const nextDescription = data.description || paymentDescription;
        const nextAmount = data.amount || amountInput;
        const nextAsset = data.asset || assetChoice;
        const nextDeliverables = data.deliverables
          ? data.deliverables.join(", ")
          : deliverablesInput;
        const nextCondition = data.condition || conditionInput;
        const nextDeadlineDays = data.deadlineDays || deadlineDays;

        if (data.title) setPaymentTitle(data.title);
        if (data.description) setPaymentDescription(data.description);
        if (data.amount) setAmountInput(data.amount);
        if (data.asset) setAssetChoice(data.asset);
        if (data.deliverables) setDeliverablesInput(data.deliverables.join(", "));
        if (data.condition) setConditionInput(data.condition);
        if (data.deadlineDays) setDeadlineDays(data.deadlineDays);
        if (data.transactionType) setSelectedType(data.transactionType);

        setViewMode("guided_creator");
        setCurrentStep(5);
        runCheckerAudit(
          buildTermsObject({
            title: nextTitle,
            description: nextDescription,
            amount: nextAmount,
            asset: nextAsset,
            deliverables: nextDeliverables,
            condition: nextCondition,
            deadlineDays: nextDeadlineDays,
          })
        );
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Could not prepare agreement draft right now.");
    } finally {
      setAiLoading(false);
    }
  };

  // Build Terms Object for audit and persistence
  const buildTermsObject = (overrides?: {
    title?: string;
    description?: string;
    amount?: string;
    asset?: "USDC" | "XLM";
    deliverables?: string;
    condition?: string;
    deadlineDays?: number;
  }): AgreementTerms => {
    const rawDeliverables = overrides?.deliverables ?? deliverablesInput;
    const parsedDeliverables = rawDeliverables
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);

    const rawAmount = (overrides?.amount ?? amountInput).trim();
    const numericAmount = parseFloat(rawAmount);
    const normalizedAmount =
      Number.isFinite(numericAmount) && numericAmount > 0
        ? /^\d+(\.\d{1,7})$/.test(rawAmount)
          ? rawAmount.includes(".") && rawAmount.split(".")[1].length < 2
            ? numericAmount.toFixed(2)
            : rawAmount
          : numericAmount.toFixed(2)
        : "0.00";
    const rawDays = overrides?.deadlineDays ?? deadlineDays;
    const otherParty =
      counterpartyInput.trim() ||
      (isRequestFlow
        ? "GC2YDKW52O7MJ62JGPZGQSKWDN6YUHXU3M32QJQ6DFRBATWL6RIHUOP6"
        : "GAA3NUA7AXVA54TYMPHTHB6UKZ7ZGFJHUIPOFPPU5TDL5KI2BLCBAJNX");

    const payer = isRequestFlow ? otherParty : currentUserAddress;
    const recipient = isRequestFlow ? currentUserAddress : otherParty;
    const approver = isRequestFlow ? otherParty : currentUserAddress;

    return {
      amount: normalizedAmount,
      asset: overrides?.asset ?? assetChoice,
      payer,
      recipient,
      approver,
      title: (overrides?.title ?? paymentTitle).trim() || "Payment Agreement",
      description:
        (overrides?.description ?? paymentDescription).trim() ||
        "Work terms and deliverables",
      deliverables:
        parsedDeliverables.length > 0 ? parsedDeliverables : ["Agreed deliverables"],
      condition:
        (overrides?.condition ?? conditionInput).trim() ||
        "Client reviews and approves completed work",
      cancellationTerms:
        "Mutual cancellation permitted prior to approval, or agreed review if past deadline",
      deadline: new Date(Date.now() + 86400000 * rawDays).toISOString(),
      contractId: STELLAR_TESTNET_CONFIG.contractId,
      domain: STELLAR_TESTNET_CONFIG.domainSeparator,
      network: STELLAR_TESTNET_CONFIG.network,
      version: 1,
    };
  };

  // Run Clarity Check Audit
  const runCheckerAudit = async (terms: AgreementTerms) => {
    setChecking(true);
    try {
      const response = await fetch("/api/ai/check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
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

  // Step validation before advancing
  const validateStep = (step: number): boolean => {
    setStepValidationError(null);
    if (step === 1) {
      if (!currentUserAddress || !validateStellarAddress(currentUserAddress)) {
        setStepValidationError("Please link a Stellar wallet in Account details (or use Dev Sandbox) before creating an agreement.");
        return false;
      }
      const addr = counterpartyInput.trim();
      if (!addr || !validateStellarAddress(addr)) {
        setStepValidationError("Please select a contact or enter a valid Stellar account address starting with G.");
        return false;
      }
      if (addr === currentUserAddress) {
        setStepValidationError("Payer and recipient cannot be the same account address.");
        return false;
      }
    }
    if (step === 2) {
      if (!paymentTitle.trim()) {
        setStepValidationError("Please enter an agreement title.");
        return false;
      }
    }
    if (step === 3) {
      const trimmed = amountInput.trim();
      const parsed = parseFloat(trimmed);
      if (Number.isNaN(parsed) || parsed <= 0) {
        setStepValidationError("Please enter a valid payment amount greater than zero.");
        return false;
      }
      try {
        const normalized = /^\d+(\.\d{1,7})$/.test(trimmed)
          ? trimmed
          : parsed.toFixed(2);
        toStroopUnits(normalized);
      } catch (err: any) {
        setStepValidationError(err.message || "Enter a positive amount with up to 7 decimals.");
        return false;
      }
    }
    if (step === 4) {
      if (!conditionInput.trim()) {
        setStepValidationError("Please describe what must happen before payment is released.");
        return false;
      }
    }
    if (step === 5 && checkerAudit?.overallStatus === "BLOCKING_ISSUES") {
      setStepValidationError("Resolve blocking clarity findings before finalizing this agreement.");
      return false;
    }
    return true;
  };

  // Finalize Agreement and Save to Server
  const handleFinalizeAgreement = async () => {
    setErrorMessage(null);
    if (checkerAudit?.overallStatus === "BLOCKING_ISSUES") {
      setErrorMessage("Resolve blocking review findings before creating this agreement.");
      return;
    }
    setSubmittingAgreement(true);
    try {
      const terms = buildTermsObject();
      toStroopUnits(terms.amount);

      const canonicalHash = await computeAgreementHash(terms);
      const agreementId = `agr-${Date.now()}`;

      const payload = {
        id: agreementId,
        transactionType: selectedType,
        title: terms.title,
        description: terms.description,
        terms,
        canonicalHash,
        status: "CREATED",
      };

      const res = await fetch("/api/agreements", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify(payload),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || "Could not save agreement. Please verify your inputs and try again.");
      }

      onAgreementCreated(body);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to create payment agreement.");
    } finally {
      setSubmittingAgreement(false);
    }
  };

  const shortcuts = [
    {
      id: "create",
      label: "Create payment",
      icon: PlusCircle,
      onClick: () => handleStartCreator("WORK"),
    },
    {
      id: "pay",
      label: "Pay someone",
      icon: Send,
      onClick: () => handleStartCreator("PROTECTED_PAYMENT"),
    },
    {
      id: "request",
      label: "Request payment",
      icon: ArrowDownLeft,
      onClick: () => handleStartCreator("CONDITIONAL_DISBURSEMENT"),
    },
    {
      id: "activity",
      label: "View activity",
      icon: Clock,
      onClick: () => onNavigateTab && onNavigateTab("all-agreements"),
    },
  ];

  const hasValidPrompt = aiPromptInput.trim().length > 0;

  /* ==============================================================
     VIEW MODE 1: CONVERSATIONAL WORKSPACE
     1. Contextual greeting
     2. Four compact shortcuts
     3. ONE unified composer (Top row: Ask TrustFlow + Send; Underneath: placeholder + single input)
     4. Optional concise recent activity links
  ============================================================== */
  if (viewMode === "overview") {
    return (
      <motion.div
        initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="max-w-2xl mx-auto min-h-[calc(100dvh-7.5rem)] flex flex-col justify-center py-4"
      >
        <div className="space-y-6">
          {/* 1. Greeting */}
          <div className="text-center space-y-1">
            <h1 className="font-display font-semibold tracking-tight text-2xl sm:text-3xl text-slate-950 dark:text-white text-balance">
              {firstName ? `Hi ${firstName}, what would you like to set up?` : "What would you like to set up?"}
            </h1>
          </div>

          {/* 2. Four Compact Shortcuts */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {shortcuts.map((item) => {
              const Icon = item.icon;
              return (
                <motion.button
                  key={item.id}
                  type="button"
                  onClick={item.onClick}
                  whileHover={shouldReduceMotion ? undefined : { y: -1 }}
                  whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
                  className="flex items-center gap-2.5 px-3.5 min-h-[44px] py-2 rounded-xl bg-[var(--tf-surface)] border border-[var(--tf-border)] hover:border-slate-300 dark:hover:border-slate-600 text-left transition-colors cursor-pointer"
                >
                  <Icon className="w-4 h-4 shrink-0 text-[#4A2574] dark:text-[#F5D03A]" />
                  <span className="text-xs sm:text-[13px] font-medium text-slate-800 dark:text-slate-100 whitespace-nowrap truncate">
                    {item.label}
                  </span>
                </motion.button>
              );
            })}
          </div>

          {/* 3. ONE Unified Composer Container */}
          <div className="space-y-2.5">
            <div
              onClick={() => textareaRef.current?.focus()}
              className="rounded-2xl bg-[var(--tf-surface)] border border-[var(--tf-border)] focus-within:border-[#4A2574] dark:focus-within:border-[#F5D03A] focus-within:ring-2 focus-within:ring-[#4A2574]/10 dark:focus-within:ring-[#F5D03A]/15 shadow-xs transition-all p-4 cursor-text"
            >
              {/* Top Row: Heading left, Send button extreme right */}
              <div className="flex items-center justify-between gap-3 mb-2">
                <label
                  htmlFor="workspace-composer"
                  className="text-sm font-semibold text-slate-950 dark:text-white cursor-text select-none"
                >
                  Ask TrustFlow
                </label>

                <motion.button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAiDraft();
                  }}
                  disabled={aiLoading || !hasValidPrompt}
                  whileTap={shouldReduceMotion ? undefined : { scale: 0.94 }}
                  aria-label="Send"
                  className="w-9 h-9 rounded-xl bg-[#F5D03A] hover:bg-[#E7BF24] disabled:bg-slate-200 dark:disabled:bg-slate-800 text-slate-950 disabled:text-slate-400 flex items-center justify-center shrink-0 transition-colors cursor-pointer disabled:cursor-not-allowed"
                >
                  {aiLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ArrowUp className="w-4 h-4 stroke-[2.25]" />
                  )}
                </motion.button>
              </div>

              {/* Beneath the heading: unified multiline input with descriptive placeholder */}
              <textarea
                id="workspace-composer"
                ref={textareaRef}
                rows={2}
                value={aiPromptInput}
                onChange={(e) => setAiPromptInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleAiDraft();
                  }
                }}
                placeholder="Describe the payment or agreement you want to create"
                className="w-full resize-none bg-transparent text-sm sm:text-[15px] text-slate-950 dark:text-white placeholder:text-[var(--tf-muted)] focus:outline-none leading-relaxed max-h-44"
              />
            </div>

            <AnimatePresence>
              {clarification && (
                <motion.div
                  initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={shouldReduceMotion ? undefined : { opacity: 0, y: -4 }}
                  className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/50 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{clarification}</span>
                </motion.div>
              )}

              {errorMessage && (
                <motion.div
                  initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={shouldReduceMotion ? undefined : { opacity: 0, y: -4 }}
                  className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200/80 dark:border-red-900/50 text-xs text-red-700 dark:text-red-300 flex items-start gap-2.5"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMessage}</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* 4. Relevant Recent Activity (concise, optional) */}
          {recentAgreements.length > 0 && (
            <div className="pt-2 space-y-2">
              <div className="flex items-center justify-between text-xs text-[var(--tf-muted)] px-1">
                <span>Recent activity</span>
                {onNavigateTab && (
                  <button
                    type="button"
                    onClick={() => onNavigateTab("all-agreements")}
                    className="hover:text-slate-950 dark:hover:text-white transition-colors cursor-pointer"
                  >
                    View all
                  </button>
                )}
              </div>
              <div className="divide-y divide-[var(--tf-border)] rounded-xl border border-[var(--tf-border)] bg-[var(--tf-surface)] overflow-hidden">
                {recentAgreements.map((agr) => {
                  const status = getAgreementVisualStatus(agr);
                  const toneClasses = getToneClasses(status.tone);
                  return (
                    <button
                      key={agr.id}
                      type="button"
                      onClick={() => onSelectAgreement && onSelectAgreement(agr)}
                      className="w-full px-3.5 py-2.5 text-left flex items-center justify-between gap-3 hover:bg-[var(--tf-surface-subtle)]/70 transition-colors cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-slate-950 dark:text-white truncate">
                          {agr.title}
                        </div>
                        <div className={`text-[11px] ${toneClasses.text}`}>
                          {status.label}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 text-xs font-semibold text-slate-950 dark:text-white tabular-nums">
                        <span>
                          {agr.terms?.amount || "0.00"} {agr.terms?.asset || "USDC"}
                        </span>
                        <ChevronRight className="w-3.5 h-3.5 text-[var(--tf-muted)]" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  /* ==============================================================
     VIEW MODE 2: GUIDED 6-STEP PAYMENT CREATOR
     Handles Create payment (WORK), Pay someone (PROTECTED_PAYMENT),
     and Request payment (CONDITIONAL_DISBURSEMENT) distinctly.
  ============================================================== */
  const flowBadge = isRequestFlow
    ? "Payment request"
    : isPaySomeoneFlow
    ? "Protected payment"
    : "Work agreement";

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="max-w-xl mx-auto space-y-5"
    >
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setViewMode("overview")}
          className="inline-flex items-center gap-1.5 min-h-[36px] text-xs font-medium text-[var(--tf-muted)] hover:text-slate-950 dark:hover:text-white transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to workspace</span>
        </button>

        <span className="text-xs font-medium text-[var(--tf-muted)] tabular-nums">
          {flowBadge} · Step {currentStep} of 6
        </span>
      </div>

      {/* Slim Progress Indicator */}
      <div className="h-1 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
        <motion.div
          className="h-full bg-[#F5D03A] rounded-full"
          initial={false}
          animate={{ width: `${(currentStep / 6) * 100}%` }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>

      {/* Step Surface */}
      <div className="bg-[var(--tf-surface)] border border-[var(--tf-border)] rounded-2xl p-5 sm:p-7 shadow-xs space-y-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={shouldReduceMotion ? false : { opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0, x: -8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Step 1: Counterparty */}
            {currentStep === 1 && (
              <div className="space-y-4">
                <div>
                  <h2 className="font-display font-bold text-xl sm:text-2xl text-slate-950 dark:text-white">
                    {isRequestFlow
                      ? "Who are you requesting payment from?"
                      : "Who is receiving this payment?"}
                  </h2>
                  <p className="text-xs sm:text-sm text-[var(--tf-muted)] mt-1">
                    {isRequestFlow
                      ? "The client or funder you enter will review and fund this request."
                      : "Select a contact or paste their account address."}
                  </p>
                </div>

                <div className="space-y-2">
                  <span className="text-xs font-medium text-[var(--tf-muted)] block">
                    Saved contacts
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {quickContacts.map((contact, idx) => {
                      const active = counterpartyInput === contact.address;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setCounterpartyName(contact.name);
                            setCounterpartyInput(contact.address);
                            setStepValidationError(null);
                          }}
                          className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                            active
                              ? "border-[#F5D03A] bg-[#F5D03A]/10 text-slate-950 dark:text-white"
                              : "border-[var(--tf-border)] hover:bg-[var(--tf-surface-subtle)] text-slate-700 dark:text-slate-300"
                          }`}
                        >
                          <div className="text-xs font-semibold">{contact.name}</div>
                          <div className="text-[11px] text-[var(--tf-muted)] font-mono mt-0.5 truncate">
                            {contact.address.slice(0, 14)}...
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {isRequestFlow ? "Client / funder account address" : "Recipient account address"}
                  </label>
                  <input
                    type="text"
                    value={counterpartyInput}
                    onChange={(e) => {
                      setCounterpartyInput(e.target.value);
                      setCounterpartyName("");
                      setStepValidationError(null);
                    }}
                    placeholder="G..."
                    className="w-full px-3.5 py-2.5 text-xs sm:text-sm font-mono bg-[var(--tf-surface-subtle)] border border-[var(--tf-border)] rounded-xl focus:outline-none focus:border-[#4A2574] dark:focus:border-[#F5D03A] text-slate-950 dark:text-white"
                  />
                </div>
              </div>
            )}

            {/* Step 2: Scope */}
            {currentStep === 2 && (
              <div className="space-y-4">
                <div>
                  <h2 className="font-display font-bold text-xl sm:text-2xl text-slate-950 dark:text-white">
                    {isRequestFlow
                      ? "What work are you requesting payment for?"
                      : "What is this payment for?"}
                  </h2>
                  <p className="text-xs sm:text-sm text-[var(--tf-muted)] mt-1">
                    Keep the title and summary clear so both parties share the same expectations.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Title
                  </label>
                  <input
                    type="text"
                    value={paymentTitle}
                    onChange={(e) => {
                      setPaymentTitle(e.target.value);
                      setStepValidationError(null);
                    }}
                    placeholder="e.g. Website redesign"
                    className="w-full px-3.5 py-2.5 text-sm bg-[var(--tf-surface-subtle)] border border-[var(--tf-border)] rounded-xl focus:outline-none focus:border-[#4A2574] dark:focus:border-[#F5D03A] text-slate-950 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Summary
                  </label>
                  <textarea
                    rows={3}
                    value={paymentDescription}
                    onChange={(e) => setPaymentDescription(e.target.value)}
                    placeholder="Describe what will be delivered..."
                    className="w-full px-3.5 py-2.5 text-sm bg-[var(--tf-surface-subtle)] border border-[var(--tf-border)] rounded-xl focus:outline-none focus:border-[#4A2574] dark:focus:border-[#F5D03A] text-slate-950 dark:text-white"
                  />
                </div>
              </div>
            )}

            {/* Step 3: Amount & Deadline */}
            {currentStep === 3 && (
              <div className="space-y-4">
                <div>
                  <h2 className="font-display font-bold text-xl sm:text-2xl text-slate-950 dark:text-white">
                    How much is the payment?
                  </h2>
                  <p className="text-xs sm:text-sm text-[var(--tf-muted)] mt-1">
                    Set the agreed amount and delivery timeframe. Note: a 1% platform fee applies to the client or funder.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      Amount
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0.01"
                      value={amountInput}
                      onChange={(e) => {
                        setAmountInput(e.target.value);
                        setStepValidationError(null);
                      }}
                      placeholder="500.00"
                      className="w-full px-3.5 py-2.5 text-lg font-display font-bold bg-[var(--tf-surface-subtle)] border border-[var(--tf-border)] rounded-xl focus:outline-none focus:border-[#4A2574] dark:focus:border-[#F5D03A] text-slate-950 dark:text-white tabular-nums"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      Asset
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {(["USDC", "XLM"] as const).map((asset) => (
                        <button
                          key={asset}
                          type="button"
                          onClick={() => setAssetChoice(asset)}
                          className={`min-h-[46px] text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                            assetChoice === asset
                              ? "border-[#F5D03A] bg-[#F5D03A]/15 text-slate-950 dark:text-white"
                              : "border-[var(--tf-border)] text-[var(--tf-muted)] hover:bg-[var(--tf-surface-subtle)]"
                          }`}
                        >
                          {asset}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Expected delivery timeframe
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {[3, 7, 14, 30].map((days) => (
                      <button
                        key={days}
                        type="button"
                        onClick={() => setDeadlineDays(days)}
                        className={`px-3.5 min-h-[38px] rounded-xl text-xs font-medium border transition-colors cursor-pointer ${
                          deadlineDays === days
                            ? "border-[#F5D03A] bg-[#F5D03A]/15 text-slate-950 dark:text-white font-semibold"
                            : "border-[var(--tf-border)] text-[var(--tf-muted)] hover:bg-[var(--tf-surface-subtle)]"
                        }`}
                      >
                        {days} days
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Step 4: Acceptance Criteria */}
            {currentStep === 4 && (
              <div className="space-y-4">
                <div>
                  <h2 className="font-display font-bold text-xl sm:text-2xl text-slate-950 dark:text-white">
                    When should the payment be released?
                  </h2>
                  <p className="text-xs sm:text-sm text-[var(--tf-muted)] mt-1">
                    List the deliverables and what the client will check before approving release.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Deliverables (comma separated)
                  </label>
                  <input
                    type="text"
                    value={deliverablesInput}
                    onChange={(e) => setDeliverablesInput(e.target.value)}
                    placeholder="Design file, Final assets, Live preview"
                    className="w-full px-3.5 py-2.5 text-sm bg-[var(--tf-surface-subtle)] border border-[var(--tf-border)] rounded-xl focus:outline-none focus:border-[#4A2574] dark:focus:border-[#F5D03A] text-slate-950 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Acceptance criteria
                  </label>
                  <textarea
                    rows={2}
                    value={conditionInput}
                    onChange={(e) => {
                      setConditionInput(e.target.value);
                      setStepValidationError(null);
                    }}
                    placeholder="Client reviews delivery and approves release"
                    className="w-full px-3.5 py-2.5 text-sm bg-[var(--tf-surface-subtle)] border border-[var(--tf-border)] rounded-xl focus:outline-none focus:border-[#4A2574] dark:focus:border-[#F5D03A] text-slate-950 dark:text-white"
                  />
                </div>
              </div>
            )}

            {/* Step 5: Review Summary */}
            {currentStep === 5 && (
              <div className="space-y-4">
                <div>
                  <h2 className="font-display font-bold text-xl sm:text-2xl text-slate-950 dark:text-white">
                    Review terms
                  </h2>
                  <p className="text-xs sm:text-sm text-[var(--tf-muted)] mt-1">
                    Confirm the roles, amount, and release condition before creating this draft.
                  </p>
                </div>

                <div className="divide-y divide-[var(--tf-border)] rounded-xl bg-[var(--tf-surface-subtle)] border border-[var(--tf-border)] text-xs">
                  <div className="p-3.5 flex items-center justify-between gap-4">
                    <span className="text-[var(--tf-muted)]">Amount</span>
                    <span className="text-base font-display font-bold text-slate-950 dark:text-white tabular-nums">
                      {amountInput} {assetChoice}
                    </span>
                  </div>

                  <div className="p-3.5 space-y-1">
                    <span className="text-[var(--tf-muted)] block">Title</span>
                    <span className="font-semibold text-sm text-slate-950 dark:text-white">
                      {paymentTitle}
                    </span>
                  </div>

                  <div className="p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <span className="text-[var(--tf-muted)] block mb-0.5">
                        {isRequestFlow ? "Client / Funder" : "Client / Payer (You)"}
                      </span>
                      <span className="font-mono text-slate-800 dark:text-slate-200 break-all">
                        {isRequestFlow
                          ? counterpartyName || `${counterpartyInput.slice(0, 14)}...`
                          : `${currentUserAddress.slice(0, 14)}...`}
                      </span>
                    </div>
                    <div>
                      <span className="text-[var(--tf-muted)] block mb-0.5">
                        {isRequestFlow ? "Recipient (You)" : "Freelancer / Recipient"}
                      </span>
                      <span className="font-mono text-slate-800 dark:text-slate-200 break-all">
                        {isRequestFlow
                          ? `${currentUserAddress.slice(0, 14)}...`
                          : counterpartyName || `${counterpartyInput.slice(0, 14)}...`}
                      </span>
                    </div>
                  </div>

                  <div className="p-3.5 space-y-1">
                    <span className="text-[var(--tf-muted)] block">Acceptance criteria</span>
                    <span className="text-slate-800 dark:text-slate-200 leading-relaxed block">
                      {conditionInput}
                    </span>
                  </div>

                  <div className="p-3.5 space-y-1">
                    <span className="text-[var(--tf-muted)] block">Deliverables</span>
                    <span className="text-slate-800 dark:text-slate-200 block">
                      {deliverablesInput
                        .split(",")
                        .map((d) => d.trim())
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                </div>

                {checking ? (
                  <div className="flex items-center gap-2 text-xs text-[var(--tf-muted)]">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Checking terms for clarity...</span>
                  </div>
                ) : (
                  checkerAudit && (
                    <div
                      className={`p-3.5 rounded-xl border text-xs space-y-2.5 ${
                        checkerAudit.overallStatus === "BLOCKING_ISSUES"
                          ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/50"
                          : "bg-[var(--tf-surface-subtle)] border-[var(--tf-border)]"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white">
                        {checkerAudit.overallStatus === "BLOCKING_ISSUES" ? (
                          <AlertCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        )}
                        <span>
                          {checkerAudit.overallStatus === "PASS"
                            ? "Clarity review passed"
                            : checkerAudit.overallStatus === "BLOCKING_ISSUES"
                            ? "Blocking issues found"
                            : "Review notes"}
                        </span>
                      </div>
                      <p className="text-[var(--tf-muted)] leading-relaxed">
                        {checkerAudit.summary}
                      </p>
                      {Array.isArray(checkerAudit.findings) && checkerAudit.findings.length > 0 && (
                        <ul className="space-y-1.5 pt-1 border-t border-[var(--tf-border)]">
                          {checkerAudit.findings.map((finding, idx) => (
                            <li key={idx} className="text-[11px] leading-relaxed text-slate-700 dark:text-slate-300">
                              <span
                                className={`font-semibold uppercase mr-1.5 ${
                                  finding.severity === "BLOCKING"
                                    ? "text-red-600 dark:text-red-400"
                                    : finding.severity === "WARNING"
                                    ? "text-amber-600 dark:text-amber-400"
                                    : "text-[var(--tf-muted)]"
                                }`}
                              >
                                [{finding.severity}]
                              </span>
                              <span className="font-medium text-slate-900 dark:text-white">{finding.issue}:</span>{" "}
                              {finding.suggestedRevision}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )
                )}
              </div>
            )}

            {/* Step 6: Distinct Confirmation Step */}
            {currentStep === 6 && (
              <div className="space-y-4 py-1">
                <div className="w-11 h-11 rounded-2xl bg-[#F5D03A] text-slate-950 flex items-center justify-center">
                  <Check className="w-5 h-5 stroke-[2.5]" />
                </div>

                <div className="space-y-1">
                  <h2 className="font-display font-bold text-xl sm:text-2xl text-slate-950 dark:text-white">
                    {isRequestFlow
                      ? "Confirm and send payment request"
                      : "Confirm and create agreement"}
                  </h2>
                  <p className="text-xs sm:text-sm text-[var(--tf-muted)] leading-relaxed">
                    {isRequestFlow
                      ? "This creates a request for your client to review and fund. No money moves yet."
                      : "Creating the agreement does not move money yet. Funding happens in the next step once both sides accept."}
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-[var(--tf-surface-subtle)] border border-[var(--tf-border)] text-xs space-y-2">
                  <div className="flex justify-between gap-2">
                    <span className="text-[var(--tf-muted)]">Agreement</span>
                    <span className="font-medium text-slate-950 dark:text-white truncate">
                      {paymentTitle}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-[var(--tf-muted)]">Amount</span>
                    <span className="font-semibold text-slate-950 dark:text-white tabular-nums">
                      {amountInput} {assetChoice}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-[var(--tf-muted)]">Target timeframe</span>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {deadlineDays} days
                    </span>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Validation or Server Error */}
        {(stepValidationError || errorMessage) && (
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{stepValidationError || errorMessage}</span>
          </div>
        )}

        {/* Step Navigation */}
        <div className="flex items-center justify-between pt-4 border-t border-[var(--tf-border)]">
          {currentStep > 1 ? (
            <button
              type="button"
              onClick={() => {
                setStepValidationError(null);
                setCurrentStep(currentStep - 1);
              }}
              className="px-4 min-h-[42px] text-xs font-medium text-[var(--tf-muted)] hover:text-slate-950 dark:hover:text-white transition-colors cursor-pointer"
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
                if (!validateStep(currentStep)) return;
                if (currentStep === 4) {
                  runCheckerAudit(buildTermsObject());
                }
                setCurrentStep(currentStep + 1);
              }}
              className="px-5 min-h-[42px] text-xs font-semibold text-slate-950 bg-[#F5D03A] hover:bg-[#E7BF24] rounded-xl transition-colors inline-flex items-center gap-1.5 cursor-pointer"
            >
              <span>Continue</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinalizeAgreement}
              disabled={submittingAgreement}
              className="px-5 min-h-[42px] text-xs font-semibold text-slate-950 bg-[#F5D03A] hover:bg-[#E7BF24] disabled:opacity-50 rounded-xl transition-colors inline-flex items-center gap-1.5 cursor-pointer"
            >
              {submittingAgreement ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <span>{isRequestFlow ? "Create payment request" : "Create agreement"}</span>
                  <Check className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
};
