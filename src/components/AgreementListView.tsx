import React from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  Clock,
  PlusCircle,
  ChevronRight,
  CheckCircle2,
  ShieldCheck,
  AlertTriangle,
  XCircle,
  RotateCcw,
} from "lucide-react";
import { AgreementRecord } from "../types/agreement";
import { formatAddress } from "../lib/stellar/config";
import { getAgreementVisualStatus, getToneClasses } from "../lib/agreementStatus";

interface AgreementListViewProps {
  agreements: AgreementRecord[];
  activeFilter: string;
  onSelectAgreement: (agreement: AgreementRecord) => void;
  onCreateNew: () => void;
  onFilterChange?: (filter: string) => void;
}

export const AgreementListView: React.FC<AgreementListViewProps> = ({
  agreements,
  activeFilter,
  onSelectAgreement,
  onCreateNew,
  onFilterChange,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const validAgreements = agreements.filter((agr) => agr && agr.id && agr.title);

  const filteredAgreements = validAgreements.filter((agr) => {
    if (activeFilter === "all-agreements") return true;
    if (activeFilter === "pending-acceptance") {
      return agr.status === "CREATED" && (!agr.payerAccepted || !agr.recipientAccepted);
    }
    if (activeFilter === "awaiting-funding") {
      return (
        (agr.status as string) === "READY_FOR_FUNDING" ||
        (agr.status === "CREATED" && agr.payerAccepted && agr.recipientAccepted)
      );
    }
    if (activeFilter === "active-review") {
      return (
        agr.status === "FUNDED" ||
        agr.status === "FULFILMENT_SUBMITTED" ||
        agr.status === "APPROVED"
      );
    }
    if (activeFilter === "completed") {
      return (
        agr.status === "RELEASED" ||
        agr.status === "REFUNDED" ||
        agr.status === "CANCELLED"
      );
    }
    return true;
  });

  const filterTabs = [
    { id: "all-agreements", label: "All" },
    { id: "pending-acceptance", label: "Awaiting acceptance" },
    { id: "awaiting-funding", label: "Awaiting funding" },
    { id: "active-review", label: "In progress" },
    { id: "completed", label: "Completed" },
  ];

  const viewHeaderMap: Record<string, { title: string; emptyTitle: string; emptyCopy: string }> = {
    "all-agreements": {
      title: "My payments",
      emptyTitle: "No payments yet",
      emptyCopy: "Create a protected payment, pay someone with conditions, or send a payment request.",
    },
    "pending-acceptance": {
      title: "Awaiting acceptance",
      emptyTitle: "Nothing waiting for acceptance",
      emptyCopy: "Agreements waiting on the client or freelancer to confirm terms will show up here.",
    },
    "awaiting-funding": {
      title: "Awaiting funding",
      emptyTitle: "Nothing waiting for funding",
      emptyCopy: "Accepted agreements that have not been funded yet will appear here.",
    },
    "active-review": {
      title: "In progress",
      emptyTitle: "No payments in progress",
      emptyCopy: "Funded work, submitted deliverables awaiting review, and revision requests appear here.",
    },
    completed: {
      title: "Completed",
      emptyTitle: "No completed payments yet",
      emptyCopy: "Released payments, refunds, and cancelled agreements are archived here.",
    },
  };

  const viewCopy = viewHeaderMap[activeFilter] || viewHeaderMap["all-agreements"];

  const formatTypeLabel = (type?: string) => {
    if (type === "PROTECTED_PAYMENT") return "Protected payment";
    if (type === "CONDITIONAL_DISBURSEMENT") return "Payment request";
    return "Work agreement";
  };

  const renderStatusIcon = (key: string) => {
    if (key === "released" || key === "approved") {
      return <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />;
    }
    if (key === "funded" || key === "awaiting_review") {
      return <ShieldCheck className="w-3.5 h-3.5 shrink-0" />;
    }
    if (key === "work_rejected" || key === "dispute_cancel") {
      return <AlertTriangle className="w-3.5 h-3.5 shrink-0" />;
    }
    if (key === "refunded") {
      return <RotateCcw className="w-3.5 h-3.5 shrink-0" />;
    }
    if (key === "cancelled") {
      return <XCircle className="w-3.5 h-3.5 shrink-0" />;
    }
    return <Clock className="w-3.5 h-3.5 shrink-0" />;
  };

  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-5 max-w-4xl mx-auto"
    >
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--tf-border)]">
        <div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl tracking-tight text-slate-950 dark:text-white">
            {viewCopy.title}
          </h1>
          <p className="text-xs sm:text-sm text-[var(--tf-muted)] mt-0.5 tabular-nums">
            {filteredAgreements.length}{" "}
            {filteredAgreements.length === 1 ? "agreement" : "agreements"}
          </p>
        </div>

        <button
          type="button"
          onClick={onCreateNew}
          className="inline-flex items-center gap-1.5 px-4 min-h-[42px] text-xs font-semibold text-slate-950 bg-[#F5D03A] hover:bg-[#E7BF24] rounded-xl transition-colors self-start sm:self-auto cursor-pointer whitespace-nowrap"
        >
          <PlusCircle className="w-4 h-4" />
          <span>Create payment</span>
        </button>
      </div>

      {/* Filter Bar */}
      {onFilterChange && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {filterTabs.map((tab) => {
            const active = activeFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onFilterChange(tab.id)}
                className={`px-3.5 min-h-[38px] rounded-xl text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? "bg-slate-900 dark:bg-white text-white dark:text-slate-950 font-semibold"
                    : "bg-[var(--tf-surface)] border border-[var(--tf-border)] text-[var(--tf-muted)] hover:text-slate-950 dark:hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Payment List */}
      {filteredAgreements.length === 0 ? (
        <div className="text-center py-14 px-5 bg-[var(--tf-surface)] rounded-2xl border border-[var(--tf-border)]">
          <div className="w-11 h-11 rounded-full bg-[var(--tf-surface-subtle)] text-[var(--tf-muted)] mx-auto flex items-center justify-center mb-3">
            <Clock className="w-5 h-5" />
          </div>
          <h3 className="font-display font-semibold text-base text-slate-950 dark:text-white mb-1">
            {viewCopy.emptyTitle}
          </h3>
          <p className="text-xs text-[var(--tf-muted)] max-w-sm mx-auto mb-5 leading-relaxed">
            {viewCopy.emptyCopy}
          </p>
          <button
            type="button"
            onClick={onCreateNew}
            className="px-5 min-h-[42px] text-xs font-semibold text-slate-950 bg-[#F5D03A] hover:bg-[#E7BF24] rounded-xl transition-colors cursor-pointer"
          >
            Create payment
          </button>
        </div>
      ) : (
        <div className="divide-y divide-[var(--tf-border)] bg-[var(--tf-surface)] border border-[var(--tf-border)] rounded-2xl overflow-hidden">
          {filteredAgreements.map((agr) => {
            const visual = getAgreementVisualStatus(agr);
            const tone = getToneClasses(visual.tone);

            return (
              <button
                key={agr.id}
                type="button"
                onClick={() => onSelectAgreement(agr)}
                className="w-full p-4 sm:p-5 text-left hover:bg-[var(--tf-surface-subtle)]/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer group"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--tf-muted)]">
                    <span>{formatTypeLabel(agr.transactionType)}</span>
                    <span>·</span>
                    <span className={`inline-flex items-center gap-1 font-medium ${tone.text}`}>
                      {renderStatusIcon(visual.key)}
                      <span>{visual.label}</span>
                    </span>
                    {visual.isDeadlinePassed && (
                      <>
                        <span>·</span>
                        <span className="text-amber-700 dark:text-amber-300 font-medium">
                          Target date passed
                        </span>
                      </>
                    )}
                    {visual.isSimulatedTx && (
                      <>
                        <span>·</span>
                        <span className="text-[11px] text-[var(--tf-muted)]">Test simulation</span>
                      </>
                    )}
                  </div>

                  <h3 className="font-display font-semibold text-sm sm:text-base text-slate-950 dark:text-white truncate">
                    {agr.title}
                  </h3>

                  <p className="text-xs text-[var(--tf-muted)] truncate">
                    Client {formatAddress(agr.terms?.payer || "")} → Recipient{" "}
                    {formatAddress(agr.terms?.recipient || "")}
                  </p>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                  <div className="text-left sm:text-right">
                    <div className="font-display font-bold text-base sm:text-lg text-slate-950 dark:text-white tabular-nums">
                      {agr.terms?.amount || "0.00"}{" "}
                      <span className="text-xs font-medium text-[var(--tf-muted)]">
                        {agr.terms?.asset || "USDC"}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </motion.div>
  );
};
