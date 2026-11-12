import React from "react";
import { ArrowRight, Clock, ShieldCheck, Lock, CheckCircle2 } from "lucide-react";
import { AgreementRecord } from "../types/agreement";
import { formatAddress } from "../lib/stellar/config";

interface AgreementListViewProps {
  agreements: AgreementRecord[];
  activeFilter: string;
  onSelectAgreement: (agreement: AgreementRecord) => void;
  onCreateNew: () => void;
}

export const AgreementListView: React.FC<AgreementListViewProps> = ({
  agreements,
  activeFilter,
  onSelectAgreement,
  onCreateNew,
}) => {
  // Filter logic
  const filteredAgreements = agreements.filter((agr) => {
    if (activeFilter === "all-agreements") return true;
    if (activeFilter === "pending-acceptance") return agr.status === "CREATED" && (!agr.payerAccepted || !agr.recipientAccepted);
    if (activeFilter === "awaiting-funding") return agr.status === "CREATED" && agr.payerAccepted && agr.recipientAccepted;
    if (activeFilter === "active-review") return agr.status === "FUNDED" || agr.status === "FULFILMENT_SUBMITTED" || agr.status === "APPROVED";
    if (activeFilter === "completed") return agr.status === "RELEASED" || agr.status === "REFUNDED";
    return true;
  });

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h2 className="text-xl font-black text-slate-900 dark:text-white capitalize">
            {activeFilter.replace("-", " ")}
          </h2>
          <p className="text-xs text-slate-500">
            {filteredAgreements.length} {filteredAgreements.length === 1 ? "agreement" : "agreements"} found
          </p>
        </div>

        <button
          onClick={onCreateNew}
          className="px-4 py-2 text-xs font-bold text-slate-900 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-lg shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
        >
          New Agreement
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {filteredAgreements.length === 0 ? (
        <div className="text-center py-16 px-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
          <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 mx-auto flex items-center justify-center mb-3">
            <Clock className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-sm text-slate-900 dark:text-white mb-1">
            No Agreements in this View
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
            There are currently no transactions matching "{activeFilter.replace("-", " ")}".
          </p>
          <button
            onClick={onCreateNew}
            className="px-4 py-2 text-xs font-bold text-slate-900 bg-[#F5D03A] hover:bg-[#E5BF24] rounded-lg transition-colors cursor-pointer"
          >
            Create Your First Agreement
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredAgreements.map((agr) => (
            <div
              key={agr.id}
              onClick={() => onSelectAgreement(agr)}
              className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-[#F5D03A] transition-all cursor-pointer shadow-xs flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 uppercase tracking-wide">
                    {agr.transactionType.replace("_", " ")}
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                      agr.status === "RELEASED"
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                        : agr.status === "FUNDED"
                        ? "bg-purple-100 text-[#4A2574] dark:bg-purple-950/60 dark:text-purple-300"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                    }`}
                  >
                    {agr.status.replace("_", " ")}
                  </span>
                </div>

                <h3 className="font-bold text-sm text-slate-900 dark:text-white mb-1 group-hover:text-[#4A2574] dark:group-hover:text-[#F5D03A] transition-colors">
                  {agr.title}
                </h3>
                <p className="text-xs text-slate-500 line-clamp-2 mb-4 leading-relaxed">
                  {agr.description}
                </p>
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
                <div>
                  <span className="text-base font-black tabular-nums text-slate-900 dark:text-white">
                    {agr.terms.amount}{" "}
                    <span className="text-xs font-bold text-slate-500">{agr.terms.asset}</span>
                  </span>
                </div>
                <div className="text-[11px] font-bold text-[#4A2574] dark:text-[#F5D03A] flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                  View Room
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
