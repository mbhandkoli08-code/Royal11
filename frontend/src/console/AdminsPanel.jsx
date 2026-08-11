import { useCallback, useEffect, useMemo, useState } from "react";
import { Info, Percent, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useConsoleApi, fmtCoins, shortId } from "./api";
import {
  CARD, thCls, tdCls, PanelHeader, StatusBadge, UsageBar, UsageBadge,
  GhostButton, Modal, Field, PrimaryButton, Spinner, EmptyState,
} from "./primitives";

// Super Admin view of every Admin. Read-only for coin allocation (that flows
// through the Manager), but Super Admin can set each Admin's revenue split.
export const AdminsPanel = ({ query = "" }) => {
  const api = useConsoleApi();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [splitTarget, setSplitTarget] = useState(null);
  const [pct, setPct] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/admins");
      setRows(data);
    } catch {
      toast.error("Couldn't load admins");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.user.display_name.toLowerCase().includes(q) ||
      r.user.email.toLowerCase().includes(q) ||
      (r.manager_name || "").toLowerCase().includes(q) ||
      r.user.id.includes(q));
  }, [rows, query]);

  const openSplit = (r) => { setPct(String(r.revenue_split_super_admin_pct ?? 70)); setSplitTarget(r); };

  const saveSplit = async () => {
    if (busy) return;
    const v = Number(pct);
    if (v < 0 || v > 100 || Number.isNaN(v)) return toast.error("Enter 0–100");
    setBusy(true);
    try {
      await api.patch(`/admin/admins/${splitTarget.user.id}/revenue-split`, { revenue_split_super_admin_pct: v });
      toast.success("Revenue split updated");
      setSplitTarget(null);
      await load();
    } catch (e) {
      toast.error("Couldn't update split", { description: e.response?.data?.detail || "" });
    } finally { setBusy(false); }
  };

  return (
    <div data-testid="admins-panel">
      <PanelHeader title="Admins" subtitle={`${rows.length} admin${rows.length === 1 ? "" : "s"} across all managers`} />

      <div className="mb-4 flex items-center gap-2 rounded-xl border border-slate-200/60 bg-white px-4 py-3 text-xs text-slate-500">
        <Info className="h-4 w-4 shrink-0 text-sky-600" />
        Coins are allocated to an Admin by their Manager. You control each Admin's revenue split here.
      </div>

      {loading ? <Spinner label="Loading admins…" /> : filtered.length === 0 ? (
        <EmptyState testid="admins-empty" title="No admins found" subtitle="Admins appear here once a Manager creates them." />
      ) : (
        <div className={`${CARD} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-sm" data-testid="admins-table">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className={thCls}>Admin</th>
                  <th className={thCls}>Manager</th>
                  <th className={thCls}>Allocated</th>
                  <th className={thCls}>Used</th>
                  <th className={thCls}>Remaining</th>
                  <th className={thCls}>Usage</th>
                  <th className={thCls}>Players</th>
                  <th className={thCls}>SA Split</th>
                  <th className={thCls}>Status</th>
                  <th className={`${thCls} text-right`}>Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r) => (
                  <tr key={r.user.id} data-testid={`admin-row-${r.user.id}`} className="transition-colors hover:bg-slate-50">
                    <td className={tdCls}>
                      <p className="font-bold text-slate-900">{r.user.display_name}</p>
                      <p className="text-[11px] text-slate-400">{r.user.email}</p>
                      <p className="font-mono text-[11px] text-slate-400">{shortId(r.user.id)}</p>
                    </td>
                    <td className={tdCls}>{r.manager_name}</td>
                    <td className={`${tdCls} text-sky-600`}>{fmtCoins(r.allocated)}</td>
                    <td className={tdCls}>{fmtCoins(r.used)}</td>
                    <td className={tdCls}>{fmtCoins(r.remaining)}</td>
                    <td className={tdCls}><div className="flex items-center"><UsageBar pct={r.usage_pct} /><UsageBadge level={r.usage_level} /></div></td>
                    <td className={tdCls}>{r.player_count}<span className="text-slate-400"> / {r.player_capacity}</span></td>
                    <td className={`${tdCls} font-bold text-slate-900`}>{r.revenue_split_super_admin_pct}%</td>
                    <td className={tdCls}><StatusBadge status={r.user.status} /></td>
                    <td className={tdCls}>
                      <div className="flex justify-end">
                        <GhostButton data-testid={`split-${r.user.id}`} onClick={() => openSplit(r)} className="!px-3 !py-2 text-xs"><Percent className="h-3.5 w-3.5" /> Split</GhostButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={!!splitTarget} onClose={() => setSplitTarget(null)} title={`Revenue split — ${splitTarget?.user.display_name || ""}`} testid="split-modal">
        <div className="space-y-4">
          <p className="text-xs text-slate-400">Super Admin's percentage share of this Admin's weekly collections. The Admin keeps the remainder.</p>
          <Field label="Super Admin share (%)" type="number" data-testid="split-pct" value={pct} onChange={(e) => setPct(e.target.value)} hint={`Admin keeps ${100 - (Number(pct) || 0)}%`} />
          <PrimaryButton data-testid="split-save" onClick={saveSplit} disabled={busy} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Percent className="h-4 w-4" />} Save Split
          </PrimaryButton>
        </div>
      </Modal>
    </div>
  );
};
