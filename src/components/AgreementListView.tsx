import React from "react";
import { ArrowRight, Clock, PlusCircle, CheckCircle2, ChevronRight, ShieldCheck } from "lucide-react";
import { AgreementRecord } from "../types/agreement";
import { formatAddress } from "../lib/stellar/config";

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
  // Filter logic based on plain user status
  const validAgreements = agreements.filter((agr) => agr && agr.id && agr.title);

  const filteredAgreements = validAgreements.filter((agr) => {
    if (activeFilter === "all-agreements") return true;
    if (activeFilter === "pending-acceptance") {
      return agr.status === "CREATED" && (!agr.payerAccepted || !agr.recipientAccepted);
    }
    if (activeFilter === "awaiting-funding") {
      return agr.status === "CREATED" && agr.payerAccepted && agr.recipientAccepted;
    }
    if (activeFilter === "active-review") {
      return agr.status === "FUNDED" || agr.status === "FULFILMENT_SUBMITTED" || agr.status === "APPROVED";
    }
    if (activeFilter === "completed") {
      return agr.status === "RELEASED" || agr.status === "REFUNDED";
    }
    return true;
  });

  const filterTabs = [
    { id: "all-agreements", label: "All payments" },
    { id: "pending-acceptance", label: "Waiting for agreement" },
    { id: "awaiting-funding", label: "Waiting for money" },
    { id: "active-review", label: "In progress & review" },
    { id: "completed", label: "Completed" },
  ];

  return (
    <div className="space-y-6 max-w-5xl mx-auto animate-in fade-in duration-150">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-950 dark:text-white font-display uppercase tracking-tight">
            My Payments
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            {filteredAgreements.length} {filteredAgreements.length === 1 ? "payment" : "payments"} in this view
          </p>
        </div>

        <button
          onClick={onCreateNew}
          className="px-4 py-2.5 text-xs font-bold text-slate-950 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-lg shadow-xs transition-colors flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
        >
          <PlusCircle className="w-4 h-4" />
          Create a payment
        </button>
      </div>

      {/* Filter Tabs */}
      {onFilterChange && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {filterTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onFilterChange(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                activeFilter === tab.id
                  ? "bg-slate-900 dark:bg-white text-white dark:text-slate-950 shadow-xs"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Payment Cards Grid */}
      {filteredAgreements.length === 0 ? (
        <div className="text-center py-16 px-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 mx-auto flex items-center justify-center mb-3">
            <Clock className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-sm text-slate-900 dark:text-white mb-1">
            No payments found
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mb-5 leading-relaxed">
            There are currently no transactions matching this filter. You can create a new protected payment at any time.
          </p>
          <button
            onClick={onCreateNew}
            className="px-5 py-2.5 text-xs font-bold text-slate-950 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-lg transition-colors cursor-pointer"
          >
            Create a payment
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredAgreements.map((agr) => {
            const statusLabel =
              agr.status === "RELEASED"
                ? "Completed"
                : agr.status === "FUNDED"
                ? "Money secured"
                : agr.status === "FULFILMENT_SUBMITTED"
                ? "Under review"
                : agr.payerAccepted && agr.recipientAccepted
                ? "Ready to add money"
                : "Awaiting acceptance";

            const statusColor =
              agr.status === "RELEASED"
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                : agr.status === "FUNDED" || agr.status === "FULFILMENT_SUBMITTED"
                ? "bg-purple-100 text-[#4A2574] dark:bg-purple-950/60 dark:text-purple-300"
                : "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300";

            return (
              <div
                key={agr.id}
                onClick={() => onSelectAgreement(agr)}
                className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-[#F5D03A] transition-all cursor-pointer shadow-xs flex flex-col justify-between group"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 uppercase tracking-wide">
                      {(agr.transactionType || "WORK").replace("_", " ")}
                    </span>
                    <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${statusColor}`}>
                      {statusLabel}
                    </span>
                  </div>

                  <h3 className="font-bold text-sm text-slate-950 dark:text-white mb-1.5 group-hover:text-[#4A2574] dark:group-hover:text-[#F5D03A] transition-colors">
                    {agr.title}
                  </h3>
                  <p className="text-xs text-slate-500 line-clamp-2 mb-4 leading-relaxed">
                    {agr.description || "Payment agreement"}
                  </p>

                  <div className="text-[11px] text-slate-400 space-y-1 mb-4">
                    <div>
                      Payer: <span className="font-mono text-slate-700 dark:text-slate-300">{formatAddress(agr.terms?.payer || "")}</span>
                    </div>
                    <div>
                      Recipient: <span className="font-mono text-slate-700 dark:text-slate-300">{formatAddress(agr.terms?.recipient || "")}</span>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
                  <div>
                    <span className="text-lg font-black tabular-nums text-slate-950 dark:text-white stat-highlight">
                      {agr.terms?.amount || "0.00"}
                    </span>
                    <span className="text-xs font-bold text-slate-500 ml-1.5">
                      {agr.terms?.asset || "USDC"}
                    </span>
                  </div>

                  <div className="text-xs font-bold text-slate-700 dark:text-slate-300 group-hover:text-[#4A2574] dark:group-hover:text-[#F5D03A] flex items-center gap-1 transition-transform group-hover:translate-x-0.5">
                    Open details
                    <ChevronRight className="w-4 h-4" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
