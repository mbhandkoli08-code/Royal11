import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Wallet2, SlidersHorizontal, Loader2, Globe2, BadgeIndianRupee } from "lucide-react";
import { toast } from "sonner";
import { useConsoleApi, fmtCoins, shortId } from "./api";
import {
  CARD, thCls, tdCls, PanelHeader, PrimaryButton, GhostButton,
  StatusBadge, UsageBar, Modal, Field, Spinner, EmptyState,
} from "./primitives";

// Super Admin: create + fund + set quota for Zonal Managers.
export const ZonalManagersPanel = ({ query = "" }) => {
  const api = useConsoleApi();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({});

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/zonal-managers");
      setRows(data);
    } catch { toast.error("Couldn't load zonal managers"); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.user.display_name.toLowerCase().includes(q) || r.user.email.toLowerCase().includes(q) || r.user.id.includes(q));
  }, [rows, query]);

  const submitCreate = async () => {
    if (busy) return; setBusy(true);
    try {
      await api.post("/admin/zonal-managers", {
        email: form.email.trim(), password: form.password,
        display_name: form.display_name.trim(), authorized_quota: Number(form.authorized_quota) || 0,
      });
      toast.success("Zonal Manager created"); setModal(null); await load();
    } catch (e) { toast.error("Couldn't create", { description: e.response?.data?.detail || "" }); }
    finally { setBusy(false); }
  };
  const submitFund = async () => {
    if (busy) return;
    const amount = Number(form.amount);
    if (!amount || amount <= 0) return toast.error("Enter a positive amount");
    setBusy(true);
    try {
      await api.post(`/admin/zonal-managers/${modal.row.user.id}/fund`, { amount, reason: form.reason || undefined, request_id: crypto.randomUUID() });
      toast.success(`Funded ${fmtCoins(amount)} coins`); setModal(null); await load();
    } catch (e) { toast.error("Couldn't fund", { description: e.response?.data?.detail || "" }); }
    finally { setBusy(false); }
  };
  const submitQuota = async () => {
    if (busy) return; setBusy(true);
    try {
      await api.patch(`/admin/zonal-managers/${modal.row.user.id}/quota`, { authorized_quota: Number(form.authorized_quota) || 0 });
      toast.success("Quota updated"); setModal(null); await load();
    } catch (e) { toast.error("Couldn't update quota", { description: e.response?.data?.detail || "" }); }
    finally { setBusy(false); }
  };
  const submitPayroll = async () => {
    if (busy) return; setBusy(true);
    try {
      await api.patch(`/admin/zonal-managers/${modal.row.user.id}/payroll`, {
        weekly_salary_inr: Number(form.weekly_salary_inr) || 0,
        incentive_target_inr: Number(form.incentive_target_inr) || 0,
        incentive_pct: Number(form.incentive_pct) || 0,
      });
      toast.success("Payroll updated"); setModal(null); await load();
    } catch (e) { toast.error("Couldn't update payroll", { description: e.response?.data?.detail || "" }); }
    finally { setBusy(false); }
  };

  return (
    <div data-testid="zonal-managers-panel">
      <PanelHeader
        title="Zonal Managers"
        subtitle={`${rows.length} zonal manager${rows.length === 1 ? "" : "s"} — each oversees a zone of Managers`}
        actions={<PrimaryButton data-testid="add-zonal-btn" onClick={() => { setForm({ email: "", password: "", display_name: "", authorized_quota: "" }); setModal("create"); }}><Plus className="h-4 w-4" /> Add Zonal Manager</PrimaryButton>}
      />
      {loading ? <Spinner label="Loading zonal managers…" /> : filtered.length === 0 ? (
        <EmptyState testid="zonal-empty" title="No zonal managers yet" subtitle="Create one, then it can create and fund Managers in its zone." />
      ) : (
        <div className={`${CARD} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm" data-testid="zonal-table">
              <thead><tr className="border-b border-slate-100">
                <th className={thCls}>Zonal Manager</th><th className={thCls}>Status</th>
                <th className={thCls}>Quota</th><th className={thCls}>Allocated</th><th className={thCls}>Remaining</th>
                <th className={thCls}>Usage</th><th className={thCls}>Managers</th><th className={thCls}>Wallet</th>
                <th className={`${thCls} text-right`}>Actions</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r) => (
                  <tr key={r.user.id} data-testid={`zonal-row-${r.user.id}`} className="transition-colors hover:bg-slate-50">
                    <td className={tdCls}>
                      <p className="font-bold text-slate-900">{r.user.display_name}</p>
                      <p className="text-[11px] text-slate-400">{r.user.email}</p>
                      <p className="font-mono text-[11px] text-slate-400">{shortId(r.user.id)}</p>
                    </td>
                    <td className={tdCls}><StatusBadge status={r.user.status} /></td>
                    <td className={`${tdCls} text-sky-600`}>{fmtCoins(r.authorized_quota)}</td>
                    <td className={tdCls}>{fmtCoins(r.allocated_out)}</td>
                    <td className={tdCls}>{fmtCoins(r.remaining)}</td>
                    <td className={tdCls}><UsageBar pct={r.usage_pct} /></td>
                    <td className={tdCls}>{r.manager_count}</td>
                    <td className={tdCls}>{fmtCoins(r.wallet_balance)}</td>
                    <td className={tdCls}>
                      <div className="flex items-center justify-end gap-2">
                        <GhostButton data-testid={`fund-zonal-${r.user.id}`} onClick={() => { setForm({ amount: "", reason: "" }); setModal({ type: "fund", row: r }); }} className="!px-3 !py-2 text-xs"><Wallet2 className="h-3.5 w-3.5" /> Fund</GhostButton>
                        <GhostButton data-testid={`quota-zonal-${r.user.id}`} onClick={() => { setForm({ authorized_quota: r.authorized_quota }); setModal({ type: "quota", row: r }); }} className="!px-3 !py-2 text-xs"><SlidersHorizontal className="h-3.5 w-3.5" /> Quota</GhostButton>
                        <GhostButton data-testid={`payroll-zonal-${r.user.id}`} onClick={() => { setForm({ weekly_salary_inr: r.weekly_salary_inr ?? 0, incentive_target_inr: r.incentive_target_inr ?? 0, incentive_pct: r.incentive_pct ?? 0 }); setModal({ type: "payroll", row: r }); }} className="!px-3 !py-2 text-xs"><BadgeIndianRupee className="h-3.5 w-3.5" /> Pay</GhostButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={modal === "create"} onClose={() => setModal(null)} title="Add Zonal Manager" testid="create-zonal-modal">
        <div className="space-y-4">
          <Field label="Display name" data-testid="cz-name" value={form.display_name || ""} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} placeholder="e.g. North Zone" />
          <Field label="Email" type="email" data-testid="cz-email" value={form.email || ""} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="zonal@royal11.com" />
          <Field label="Password" type="password" data-testid="cz-password" value={form.password || ""} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} hint="Minimum 8 characters" />
          <Field label="Authorized quota" type="number" data-testid="cz-quota" value={form.authorized_quota ?? ""} onChange={(e) => setForm((f) => ({ ...f, authorized_quota: e.target.value }))} hint="Max coins this Zonal Manager may push down to Managers" />
          <PrimaryButton data-testid="cz-submit" onClick={submitCreate} disabled={busy || !form.email || !form.password || !form.display_name} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe2 className="h-4 w-4" />} Create Zonal Manager
          </PrimaryButton>
        </div>
      </Modal>

      <Modal open={modal?.type === "fund"} onClose={() => setModal(null)} title={`Fund ${modal?.row?.user.display_name || ""}`} testid="fund-zonal-modal">
        <div className="space-y-4">
          <p className="text-xs text-slate-400">Credits real, spendable coins into this Zonal Manager's wallet so they can fund their Managers.</p>
          <Field label="Amount" type="number" data-testid="fund-zonal-amount" value={form.amount || ""} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="e.g. 500000" />
          <Field label="Reason (optional)" data-testid="fund-zonal-reason" value={form.reason || ""} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
          <PrimaryButton data-testid="fund-zonal-submit" onClick={submitFund} disabled={busy} className="w-full">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet2 className="h-4 w-4" />} Fund Wallet</PrimaryButton>
        </div>
      </Modal>

      <Modal open={modal?.type === "quota"} onClose={() => setModal(null)} title={`Set quota — ${modal?.row?.user.display_name || ""}`} testid="quota-zonal-modal">
        <div className="space-y-4">
          <p className="text-xs text-slate-400">Caps how many coins this Zonal Manager may allocate out. Cannot be set below what's already allocated ({fmtCoins(modal?.row?.allocated_out)}).</p>
          <Field label="Authorized quota" type="number" data-testid="quota-zonal-amount" value={form.authorized_quota ?? ""} onChange={(e) => setForm((f) => ({ ...f, authorized_quota: e.target.value }))} />
          <PrimaryButton data-testid="quota-zonal-submit" onClick={submitQuota} disabled={busy} className="w-full">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SlidersHorizontal className="h-4 w-4" />} Update Quota</PrimaryButton>
        </div>
      </Modal>

      <Modal open={modal?.type === "payroll"} onClose={() => setModal(null)} title={`Weekly pay — ${modal?.row?.user.display_name || ""}`} testid="payroll-zonal-modal">
        <div className="space-y-4">
          <p className="text-xs text-slate-400">Paid every settlement week from the Super Admin share. Salary is guaranteed; incentive is a bonus only when zone downline confirmed-deposit revenue meets the target.</p>
          <Field label="Weekly salary (₹)" type="number" data-testid="payroll-zonal-salary" value={form.weekly_salary_inr ?? ""} onChange={(e) => setForm((f) => ({ ...f, weekly_salary_inr: e.target.value }))} hint="Guaranteed each week. 0 = no salary." />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Incentive target (₹)" type="number" data-testid="payroll-zonal-target" value={form.incentive_target_inr ?? ""} onChange={(e) => setForm((f) => ({ ...f, incentive_target_inr: e.target.value }))} hint="0 = no incentive" />
            <Field label="Incentive %" type="number" data-testid="payroll-zonal-pct" value={form.incentive_pct ?? ""} onChange={(e) => setForm((f) => ({ ...f, incentive_pct: e.target.value }))} hint="of zone revenue" />
          </div>
          <PrimaryButton data-testid="payroll-zonal-submit" onClick={submitPayroll} disabled={busy} className="w-full">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeIndianRupee className="h-4 w-4" />} Save Payroll</PrimaryButton>
        </div>
      </Modal>
    </div>
  );
};
