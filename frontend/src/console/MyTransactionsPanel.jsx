import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useConsoleApi, fmtCoins, fmtDate, shortId } from "./api";
import { CARD, thCls, tdCls, PanelHeader, StatusBadge, Spinner, EmptyState } from "./primitives";

const Amount = ({ value }) => (
  <span className={value < 0 ? "font-bold text-rose-600" : "font-bold text-emerald-600"}>
    {value < 0 ? "−" : "+"}{fmtCoins(Math.abs(value))}
  </span>
);

// Read-only personal ledger for Manager/Admin, sourced from /wallet/me.
export const MyTransactionsPanel = () => {
  const api = useConsoleApi();
  const [txns, setTxns] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/wallet/me?limit=100");
      setTxns(data.transactions);
    } catch {
      toast.error("Couldn't load your transactions");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Spinner label="Loading your transactions…" />;

  return (
    <div data-testid="my-transactions-panel">
      <PanelHeader title="Transaction History" subtitle="Your wallet’s completed coin movements, newest first." />
      {txns.length === 0 ? (
        <EmptyState testid="my-txns-empty" title="No transactions yet" subtitle="Your coin movements will show up here." />
      ) : (
        <div className={`${CARD} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm" data-testid="my-transactions-table">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className={thCls}>Txn ID</th>
                  <th className={thCls}>Type</th>
                  <th className={thCls}>Amount</th>
                  <th className={thCls}>Balance After</th>
                  <th className={thCls}>Date / Time</th>
                  <th className={thCls}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {txns.map((t) => (
                  <tr key={t.id} data-testid={`my-txn-row-${t.id}`} className="transition-colors hover:bg-slate-50">
                    <td className={`${tdCls} font-mono text-[11px] text-slate-400`}>{shortId(t.id)}</td>
                    <td className={`${tdCls} text-xs font-semibold text-slate-500`}>{(t.type || "").replaceAll("_", " ")}</td>
                    <td className={tdCls}><Amount value={t.amount} /></td>
                    <td className={tdCls}>{fmtCoins(t.balance_after)}</td>
                    <td className={`${tdCls} text-xs text-slate-400`}>{fmtDate(t.created_at)}</td>
                    <td className={tdCls}><StatusBadge status={t.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
