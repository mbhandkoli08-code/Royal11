import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { useConsoleApi, fmtCoins } from "./api";
import { CARD, thCls, tdCls, PanelHeader, PrimaryButton, StatusBadge, Modal, Spinner, EmptyState } from "./primitives";

// Super Admin weekly settlements. Amounts in ₹. Overdue PENDING settlements
// auto-suspend the Admin (handled server-side); settling here lifts that.
export const SettlementsPanel = ({ query = "" }) => {
  const api = useConsoleApi();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/settlements");
      setRows(data);
    } catch {
      toast.error("Couldn't load settlements");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const today = new Date().toISOString().slice(0, 10);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((s) => (s.admin_name || "").toLowerCase().includes(q) || s.week_start.includes(q));
  }, [rows, query]);

  const settle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post(`/admin/settlements/${target.id}/settle`, {});
      toast.success("Marked as settled");
      setTarget(null);
      await load();
    } catch (e) {
      toast.error("Couldn't settle", { description: e.response?.data?.detail || "" });
    } finally { setBusy(false); }
  };

  const pending = rows.filter((s) => s.status === "PENDING").length;

  return (
    <div data-testid="settlements-panel">
      <PanelHeader title="Settlements" subtitle={`${pending} pending · weekly Super Admin / Admin revenue split (Sun–Sat)`} />

      {loading ? <Spinner label="Loading settlements…" /> : filtered.length === 0 ? (
        <EmptyState testid="settlements-empty" title="No settlements yet" subtitle="Settlements are generated after each week that had confirmed deposits." />
      ) : (
        <div className={`${CARD} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm" data-testid="settlements-table">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className={thCls}>Admin</th>
                  <th className={thCls}>Week</th>
                  <th className={thCls}>Due</th>
                  <th className={thCls}>Deposits</th>
                  <th className={thCls}>Split</th>
                  <th className={thCls}>SA Share</th>
                  <th className={thCls}>Admin Share</th>
                  <th className={thCls}>Status</th>
                  <th className={`${thCls} text-right`}>Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((s) => {
                  const overdue = s.status === "PENDING" && s.due_date < today;
                  return (
                    <tr key={s.id} data-testid={`settlement-row-${s.id}`} className="transition-colors hover:bg-slate-50">
                      <td className={`${tdCls} font-bold text-slate-900`}>{s.admin_name}</td>
                      <td className={`${tdCls} text-xs text-slate-400`}>{s.week_start} → {s.week_end}</td>
                      <td className={tdCls}>
                        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${overdue ? "text-rose-600" : "text-slate-400"}`}>
                          {overdue && <CalendarClock className="h-3.5 w-3.5" />}{s.due_date}
                        </span>
                      </td>
                      <td className={`${tdCls} text-sky-600`}>₹{fmtCoins(s.total_deposits_inr)}</td>
                      <td className={tdCls}>{s.split_pct_used}%</td>
                      <td className={tdCls}>₹{fmtCoins(s.super_admin_share_inr)}</td>
                      <td className={tdCls}>₹{fmtCoins(s.admin_share_inr)}</td>
                      <td className={tdCls}><StatusBadge status={s.status} /></td>
                      <td className={tdCls}>
                        <div className="flex justify-end">
                          {s.status === "PENDING" ? (
                            <PrimaryButton data-testid={`settle-${s.id}`} onClick={() => setTarget(s)} className="!px-3 !py-2 text-xs !bg-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> Mark Settled</PrimaryButton>
                          ) : <span className="text-xs text-slate-400">—</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={!!target} onClose={() => setTarget(null)} title="Mark as settled" testid="settle-modal">
        <div className="space-y-4">
          <p className="text-xs text-slate-400">
            Confirm you've received <span className="font-bold text-sky-600">₹{fmtCoins(target?.super_admin_share_inr)}</span> from
            <span className="font-bold text-slate-900"> {target?.admin_name}</span> for the week {target?.week_start} → {target?.week_end}. This lifts any settlement-overdue suspension.
          </p>
          <PrimaryButton data-testid="settle-confirm" onClick={settle} disabled={busy} className="w-full !bg-emerald-600">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Confirm Settled
          </PrimaryButton>
        </div>
      </Modal>
    </div>
  );
};
