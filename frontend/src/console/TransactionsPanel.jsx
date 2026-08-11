import { useCallback, useEffect, useMemo, useState } from "react";
import { Undo2, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useConsoleApi, fmtCoins, fmtDate, shortId } from "./api";
import {
  CARD, thCls, tdCls, PanelHeader, GhostButton, PrimaryButton,
  StatusBadge, Modal, Field, Spinner, EmptyState, Pagination,
} from "./primitives";

const TXN_TYPES = [
  "WELCOME_BONUS", "DAILY_BONUS", "ACHIEVEMENT", "SUPER_ADMIN_TO_MANAGER",
  "MANAGER_TO_ADMIN", "ADMIN_GRANT", "GAME_ENTRY", "GAME_REWARD",
  "FANTASY_ENTRY", "FANTASY_REWARD", "REVERSAL",
];

const LIMIT = 25;

const Amount = ({ value }) => (
  <span className={value < 0 ? "font-bold text-rose-600" : "font-bold text-emerald-600"}>
    {value < 0 ? "−" : "+"}{fmtCoins(Math.abs(value))}
  </span>
);

export const TransactionsPanel = ({ query = "" }) => {
  const api = useConsoleApi();
  const [data, setData] = useState({ items: [], total: 0, skip: 0, limit: LIMIT });
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("");
  const [skip, setSkip] = useState(0);
  const [reverseTarget, setReverseTarget] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: LIMIT, skip });
      if (typeFilter) params.set("type", typeFilter);
      const { data } = await api.get(`/admin/transactions?${params.toString()}`);
      setData(data);
    } catch {
      toast.error("Couldn't load transactions");
    } finally {
      setLoading(false);
    }
  }, [api, skip, typeFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data.items;
    return data.items.filter((t) =>
      t.id.includes(q) ||
      (t.player_name || "").toLowerCase().includes(q) ||
      (t.admin_name || "").toLowerCase().includes(q) ||
      (t.manager_name || "").toLowerCase().includes(q) ||
      (t.type || "").toLowerCase().includes(q));
  }, [data.items, query]);

  const doReverse = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post(`/admin/transactions/${reverseTarget.id}/reverse`, { reason: reason || undefined });
      toast.success("Transaction reversed");
      setReverseTarget(null); setReason("");
      await load();
    } catch (e) {
      toast.error("Couldn't reverse", { description: e.response?.data?.detail || "" });
    } finally { setBusy(false); }
  };

  return (
    <div data-testid="transactions-panel">
      <PanelHeader
        title="Transactions"
        subtitle="Every coin movement, newest first. Reversals never delete history."
        actions={
          <select
            data-testid="txn-type-filter"
            value={typeFilter}
            onChange={(e) => { setSkip(0); setTypeFilter(e.target.value); }}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400"
          >
            <option value="">All types</option>
            {TXN_TYPES.map((t) => <option key={t} value={t}>{t.replaceAll("_", " ")}</option>)}
          </select>
        }
      />

      {loading ? <Spinner label="Loading transactions…" /> : filtered.length === 0 ? (
        <EmptyState testid="transactions-empty" title="No transactions" subtitle="Nothing matches the current filter." />
      ) : (
        <>
          <div className={`${CARD} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm" data-testid="transactions-table">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className={thCls}>Txn ID</th>
                    <th className={thCls}>Player / Client</th>
                    <th className={thCls}>Admin</th>
                    <th className={thCls}>Manager</th>
                    <th className={thCls}>Type</th>
                    <th className={thCls}>Amount</th>
                    <th className={thCls}>Date / Time</th>
                    <th className={thCls}>Status</th>
                    <th className={`${thCls} text-right`}>Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((t) => (
                    <tr key={t.id} data-testid={`txn-row-${t.id}`} className="transition-colors hover:bg-slate-50">
                      <td className={`${tdCls} font-mono text-[11px] text-slate-400`}>{shortId(t.id)}</td>
                      <td className={tdCls}>{t.player_name || "—"}</td>
                      <td className={tdCls}>{t.admin_name || "—"}</td>
                      <td className={tdCls}>{t.manager_name || "—"}</td>
                      <td className={`${tdCls} text-xs font-semibold text-slate-500`}>{(t.type || "").replaceAll("_", " ")}</td>
                      <td className={tdCls}><Amount value={t.amount} /></td>
                      <td className={`${tdCls} text-xs text-slate-400`}>{fmtDate(t.created_at)}</td>
                      <td className={tdCls}><StatusBadge status={t.status} /></td>
                      <td className={tdCls}>
                        <div className="flex justify-end">
                          {t.status === "COMPLETED" && t.type !== "REVERSAL" ? (
                            <GhostButton data-testid={`reverse-${t.id}`} onClick={() => setReverseTarget(t)} className="!px-3 !py-2 text-xs"><Undo2 className="h-3.5 w-3.5" /> Reverse</GhostButton>
                          ) : <span className="text-xs text-slate-400">—</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <Pagination skip={data.skip} limit={data.limit} total={data.total} onPage={setSkip} />
        </>
      )}

      <Modal open={!!reverseTarget} onClose={() => { setReverseTarget(null); setReason(""); }} title="Reverse transaction" testid="reverse-modal">
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-3 text-xs font-semibold text-rose-600">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            This creates a compensating REVERSAL entry for {reverseTarget && <Amount value={reverseTarget.amount} />}. The original row is kept for audit.
          </div>
          <Field label="Reason (optional)" data-testid="reverse-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Duplicate grant" />
          <PrimaryButton data-testid="reverse-confirm" onClick={doReverse} disabled={busy} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />} Confirm Reversal
          </PrimaryButton>
        </div>
      </Modal>
    </div>
  );
};
