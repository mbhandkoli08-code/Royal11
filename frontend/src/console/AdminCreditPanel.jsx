import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CreditCard, AlertTriangle, Check, X, RefreshCw, Wallet, TrendingUp } from "lucide-react";
import { useConsoleApi, fmtCoins, fmtDate } from "@/console/api";
import { CARD, PanelHeader, Spinner, EmptyState, StatCard, PrimaryButton, GhostButton, Modal, Field } from "@/console/primitives";

// Upline (Manager / Zonal / Super Admin) credit-line dashboard: each Admin's
// credit report, set/adjust/revoke limits, approve over-limit requests, and
// record settlement repayments.
export const AdminCreditPanel = () => {
  const api = useConsoleApi();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(null);   // {admin, mode:'limit'|'repay'}
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.get("/admin-credit/report"); setData(data); }
    catch { toast.error("Couldn't load credit report"); }
    setLoading(false);
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); setEdit(null); setVal(""); await load(); }
    catch (e) { toast.error(e.response?.data?.detail?.message || e.response?.data?.detail || "Action failed"); }
    setBusy(false);
  };
  const saveLimit = () => run(() => api.put(`/admin-credit/admin/${edit.admin.admin_id}/limit`, { credit_limit: Number(val) }), "Credit limit updated");
  const revoke = (a) => run(() => api.post(`/admin-credit/admin/${a.admin_id}/revoke`, {}), "Credit line revoked");
  const repay = () => run(() => api.post(`/admin-credit/admin/${edit.admin.admin_id}/repay`, { amount: Number(val) }), "Repayment recorded");
  const decide = (req, approve) => run(() => api.post(`/admin-credit/requests/${req.id}/${approve ? "approve" : "reject"}`, {}), approve ? "Approved" : "Rejected");

  if (loading) return <Spinner />;
  const t = data?.totals || {};

  return (
    <div data-testid="admin-credit-panel">
      <PanelHeader title="Admin Credit Line" subtitle="Pre-approved float credit, auto top-ups & outstanding debt across your admins"
        actions={<GhostButton data-testid="credit-refresh" onClick={load}><RefreshCw className="h-4 w-4" /> Refresh</GhostButton>} />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={CreditCard} label="Admins" value={t.admins || 0} testid="credit-stat-admins" />
        <StatCard icon={Wallet} label="Total credit limit" value={fmtCoins(t.total_limit || 0)} testid="credit-stat-limit" />
        <StatCard icon={TrendingUp} label="Outstanding debt" value={fmtCoins(t.total_debt || 0)} accent="cherry" testid="credit-stat-debt" />
        <StatCard icon={AlertTriangle} label="Flagged" value={t.flagged || 0} accent="cherry" testid="credit-stat-flagged" />
      </div>

      {/* Pending over-limit requests */}
      {data?.pending_requests?.length > 0 && (
        <div className={`${CARD} mb-6 p-4`} data-testid="credit-pending">
          <p className="mb-3 text-sm font-bold text-slate-900">Over-limit requests awaiting approval</p>
          {data.pending_requests.map((r) => (
            <div key={r.id} data-testid={`credit-req-${r.id}`} className="mb-2 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 p-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900">{r.admin_name} · +{fmtCoins(r.amount)}</p>
                {r.reason && <p className="truncate text-xs text-slate-500">{r.reason}</p>}
              </div>
              <div className="flex gap-2">
                <button data-testid={`credit-approve-${r.id}`} disabled={busy} onClick={() => decide(r, true)} className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white"><Check className="h-3.5 w-3.5" /> Approve</button>
                <button data-testid={`credit-reject-${r.id}`} disabled={busy} onClick={() => decide(r, false)} className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-rose-600 border border-rose-200"><X className="h-3.5 w-3.5" /> Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {data?.admins?.length === 0 ? (
        <EmptyState title="No admins in your downline" testid="credit-empty" />
      ) : (
        <div className={`${CARD} overflow-x-auto`}>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <tr><th className="px-4 py-3">Admin</th><th className="px-4 py-3">Weekly avg</th><th className="px-4 py-3">Float</th><th className="px-4 py-3">Limit</th><th className="px-4 py-3">Debt</th><th className="px-4 py-3">Available</th><th className="px-4 py-3"></th></tr>
            </thead>
            <tbody>
              {data.admins.map((a) => (
                <tr key={a.admin_id} data-testid={`credit-row-${a.admin_id}`} className={`border-t border-slate-100 ${a.flagged ? "bg-rose-50/50" : ""}`}>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-900">{a.admin_name} {a.flagged && <AlertTriangle className="ml-1 inline h-3.5 w-3.5 text-rose-500" />}</p>
                    <p className="text-xs text-slate-400">{a.last_recharge_at ? `last recharge ${fmtDate(a.last_recharge_at)}` : "no recharges"}</p>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{fmtCoins(a.weekly_avg_recharge)}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{fmtCoins(a.float_balance)}</td>
                  <td className="px-4 py-3 tabular-nums font-semibold text-slate-900">{fmtCoins(a.credit_limit)}{a.status === "REVOKED" && <span className="ml-1 text-[10px] text-rose-500">(revoked)</span>}</td>
                  <td className="px-4 py-3 tabular-nums font-bold text-rose-600">{fmtCoins(a.outstanding_debt)}</td>
                  <td className="px-4 py-3 tabular-nums text-emerald-600">{fmtCoins(a.available_credit)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      <button data-testid={`credit-setlimit-${a.admin_id}`} onClick={() => { setEdit({ admin: a, mode: "limit" }); setVal(String(a.credit_limit)); }} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Set limit</button>
                      {a.outstanding_debt > 0 && <button data-testid={`credit-repay-${a.admin_id}`} onClick={() => { setEdit({ admin: a, mode: "repay" }); setVal(""); }} className="rounded-full border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">Repay</button>}
                      {a.status === "ACTIVE" && a.credit_limit > 0 && <button data-testid={`credit-revoke-${a.admin_id}`} onClick={() => revoke(a)} className="rounded-full border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50">Revoke</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.mode === "repay" ? `Record repayment — ${edit?.admin?.admin_name}` : `Set credit limit — ${edit?.admin?.admin_name}`} testid="credit-edit-modal">
        <div className="space-y-4">
          {edit?.mode === "repay" && <p className="text-xs text-slate-500">Outstanding debt: <b>{fmtCoins(edit?.admin?.outstanding_debt)}</b>. This deducts from the admin's float (settlement cycle).</p>}
          <Field label={edit?.mode === "repay" ? "Repayment amount (coins)" : "Credit limit (coins)"} type="number" data-testid="credit-edit-input" value={val} onChange={(e) => setVal(e.target.value)} placeholder="0" />
          <PrimaryButton data-testid="credit-edit-submit" className="w-full" disabled={busy || val === ""} onClick={edit?.mode === "repay" ? repay : saveLimit}>{edit?.mode === "repay" ? "Record repayment" : "Save limit"}</PrimaryButton>
        </div>
      </Modal>
    </div>
  );
};
