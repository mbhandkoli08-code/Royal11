import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Wallet2, SlidersHorizontal, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useConsoleApi, fmtCoins, shortId } from "./api";
import {
  CARD, thCls, tdCls, PanelHeader, PrimaryButton, GhostButton,
  StatusBadge, UsageBar, Modal, Field, Spinner, EmptyState,
} from "./primitives";

export const ManagersPanel = ({ query = "" }) => {
  const api = useConsoleApi();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // "create" | {type:"fund"|"quota", row}
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({});
  const [zonalOptions, setZonalOptions] = useState([]);

  const load = useCallback(async () => {
    try {
      const [m, z] = await Promise.all([api.get("/admin/managers"), api.get("/admin/zonal-managers")]);
      setRows(m.data);
      setZonalOptions(z.data.map((x) => ({ id: x.user.id, name: x.user.display_name })));
    } catch {
      toast.error("Couldn't load managers");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.user.display_name.toLowerCase().includes(q) || r.user.id.includes(q) || r.user.email.toLowerCase().includes(q));
  }, [rows, query]);

  const openCreate = () => { setForm({ email: "", password: "", display_name: "", authorized_quota: "" }); setModal("create"); };
  const openFund = (row) => { setForm({ amount: "", reason: "" }); setModal({ type: "fund", row }); };
  const openQuota = (row) => { setForm({ authorized_quota: row.authorized_quota }); setModal({ type: "quota", row }); };
  const openCap = (row) => { setForm({ max_admins_allowed: row.max_admins_allowed ?? "" }); setModal({ type: "cap", row }); };

  const submitCreate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post("/admin/managers", {
        email: form.email.trim(), password: form.password,
        display_name: form.display_name.trim(),
        authorized_quota: Number(form.authorized_quota) || 0,
        zonal_manager_id: form.zonal_manager_id || null,
      });
      toast.success("Manager created");
      setModal(null);
      await load();
    } catch (e) {
      toast.error("Couldn't create manager", { description: e.response?.data?.detail || "" });
    } finally { setBusy(false); }
  };

  const submitFund = async () => {
    if (busy) return;
    const amount = Number(form.amount);
    if (!amount || amount <= 0) return toast.error("Enter a positive amount");
    setBusy(true);
    try {
      await api.post(`/admin/managers/${modal.row.user.id}/fund`, {
        amount, reason: form.reason || undefined, request_id: crypto.randomUUID(),
      });
      toast.success(`Funded ${fmtCoins(amount)} coins`);
      setModal(null);
      await load();
    } catch (e) {
      toast.error("Couldn't fund manager", { description: e.response?.data?.detail || "" });
    } finally { setBusy(false); }
  };

  const submitQuota = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.patch(`/admin/managers/${modal.row.user.id}/quota`, { authorized_quota: Number(form.authorized_quota) || 0 });
      toast.success("Quota updated");
      setModal(null);
      await load();
    } catch (e) {
      toast.error("Couldn't update quota", { description: e.response?.data?.detail || "" });
    } finally { setBusy(false); }
  };

  const submitCap = async () => {
    if (busy) return;
    setBusy(true);
    const raw = form.max_admins_allowed;
    const value = raw === "" || raw == null ? null : Number(raw);
    try {
      await api.patch(`/admin/managers/${modal.row.user.id}/max-admins`, { max_admins_allowed: value });
      toast.success("Admin cap updated");
      setModal(null);
      await load();
    } catch (e) {
      toast.error("Couldn't update cap", { description: e.response?.data?.detail || "" });
    } finally { setBusy(false); }
  };

  return (
    <div data-testid="managers-panel">
      <PanelHeader
        title="Managers"
        subtitle={`${rows.length} manager${rows.length === 1 ? "" : "s"} in the hierarchy`}
        actions={<PrimaryButton data-testid="add-manager-btn" onClick={openCreate}><Plus className="h-4 w-4" /> Add New Manager</PrimaryButton>}
      />

      {loading ? <Spinner label="Loading managers…" /> : filtered.length === 0 ? (
        <EmptyState testid="managers-empty" title="No managers found" subtitle="Create one with “Add New Manager”, or adjust your search." />
      ) : (
        <div className={`${CARD} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-sm" data-testid="managers-table">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className={thCls}>Manager</th>
                  <th className={thCls}>Zone</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Quota</th>
                  <th className={thCls}>Allocated</th>
                  <th className={thCls}>Remaining</th>
                  <th className={thCls}>Usage</th>
                  <th className={thCls}>Admins</th>
                  <th className={thCls}>Wallet</th>
                  <th className={`${thCls} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r) => (
                  <tr key={r.user.id} data-testid={`manager-row-${r.user.id}`} className="transition-colors hover:bg-slate-50">
                    <td className={tdCls}>
                      <p className="font-bold text-slate-900">{r.user.display_name}</p>
                      <p className="text-[11px] text-slate-400">{r.user.email}</p>
                      <p className="font-mono text-[11px] text-slate-400">{shortId(r.user.id)}</p>
                    </td>
                    <td className={tdCls}>{r.zonal_manager_name ? <span className="inline-flex rounded-md bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">{r.zonal_manager_name}</span> : <span className="text-[11px] text-slate-400">No zone</span>}</td>
                    <td className={tdCls}><StatusBadge status={r.user.status} /></td>
                    <td className={`${tdCls} text-sky-600`}>{fmtCoins(r.authorized_quota)}</td>
                    <td className={tdCls}>{fmtCoins(r.allocated_out)}</td>
                    <td className={tdCls}>{fmtCoins(r.remaining)}</td>
                    <td className={tdCls}><UsageBar pct={r.usage_pct} /></td>
                    <td className={tdCls}>
                      {r.admin_count}
                      <span className="text-slate-400"> / {r.max_admins_allowed == null ? "∞" : r.max_admins_allowed}</span>
                      {r.pending_admin_requests ? <span className="ml-1 text-amber-600">(+{r.pending_admin_requests})</span> : null}
                    </td>
                    <td className={tdCls}>{fmtCoins(r.wallet_balance)}</td>
                    <td className={tdCls}>
                      <div className="flex items-center justify-end gap-2">
                        <GhostButton data-testid={`fund-manager-${r.user.id}`} onClick={() => openFund(r)} className="!px-3 !py-2 text-xs"><Wallet2 className="h-3.5 w-3.5" /> Fund</GhostButton>
                        <GhostButton data-testid={`quota-manager-${r.user.id}`} onClick={() => openQuota(r)} className="!px-3 !py-2 text-xs"><SlidersHorizontal className="h-3.5 w-3.5" /> Quota</GhostButton>
                        <GhostButton data-testid={`cap-manager-${r.user.id}`} onClick={() => openCap(r)} className="!px-3 !py-2 text-xs"><ShieldCheck className="h-3.5 w-3.5" /> Cap</GhostButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create manager */}
      <Modal open={modal === "create"} onClose={() => setModal(null)} title="Add New Manager" testid="create-manager-modal">
        <div className="space-y-4">
          <Field label="Display name" data-testid="cm-name" value={form.display_name || ""} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} placeholder="e.g. Priya Nair" />
          <Field label="Email" type="email" data-testid="cm-email" value={form.email || ""} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="manager@royal11.com" />
          <Field label="Password" type="password" data-testid="cm-password" value={form.password || ""} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} hint="Minimum 8 characters" />
          <Field label="Authorized quota" type="number" data-testid="cm-quota" value={form.authorized_quota ?? ""} onChange={(e) => setForm((f) => ({ ...f, authorized_quota: e.target.value }))} hint="Max coins this Manager may push down to Admins" />
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-600">Zone (optional)</span>
            <select
              data-testid="cm-zone"
              value={form.zonal_manager_id || ""}
              onChange={(e) => setForm((f) => ({ ...f, zonal_manager_id: e.target.value }))}
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            >
              <option value="">No zone (reports to Super Admin)</option>
              {zonalOptions.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </label>
          <PrimaryButton data-testid="cm-submit" onClick={submitCreate} disabled={busy || !form.email || !form.password || !form.display_name} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create Manager
          </PrimaryButton>
        </div>
      </Modal>

      {/* Fund */}
      <Modal open={modal?.type === "fund"} onClose={() => setModal(null)} title={`Fund ${modal?.row?.user.display_name || ""}`} testid="fund-manager-modal">
        <div className="space-y-4">
          <p className="text-xs text-slate-400">Credits real, spendable coins into this Manager’s wallet so they can allocate to Admins.</p>
          <Field label="Amount" type="number" data-testid="fund-amount" value={form.amount || ""} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="e.g. 50000" />
          <Field label="Reason (optional)" data-testid="fund-reason" value={form.reason || ""} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
          <PrimaryButton data-testid="fund-submit" onClick={submitFund} disabled={busy} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet2 className="h-4 w-4" />} Fund Wallet
          </PrimaryButton>
        </div>
      </Modal>

      {/* Quota */}
      <Modal open={modal?.type === "quota"} onClose={() => setModal(null)} title={`Set quota — ${modal?.row?.user.display_name || ""}`} testid="quota-manager-modal">
        <div className="space-y-4">
          <p className="text-xs text-slate-400">Caps how many coins this Manager may allocate out. Cannot be set below what’s already allocated ({fmtCoins(modal?.row?.allocated_out)}).</p>
          <Field label="Authorized quota" type="number" data-testid="quota-amount" value={form.authorized_quota ?? ""} onChange={(e) => setForm((f) => ({ ...f, authorized_quota: e.target.value }))} />
          <PrimaryButton data-testid="quota-submit" onClick={submitQuota} disabled={busy} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SlidersHorizontal className="h-4 w-4" />} Update Quota
          </PrimaryButton>
        </div>
      </Modal>

      {/* Admin cap */}
      <Modal open={modal?.type === "cap"} onClose={() => setModal(null)} title={`Admin cap — ${modal?.row?.user.display_name || ""}`} testid="cap-manager-modal">
        <div className="space-y-4">
          <p className="text-xs text-slate-400">Max number of Admins this Manager may have (existing + pending requests). Currently {modal?.row?.admin_count} admin(s){modal?.row?.pending_admin_requests ? ` + ${modal?.row?.pending_admin_requests} pending` : ""}. Leave blank for unlimited.</p>
          <Field label="Max admins" type="number" data-testid="cap-amount" value={form.max_admins_allowed ?? ""} onChange={(e) => setForm((f) => ({ ...f, max_admins_allowed: e.target.value }))} placeholder="Blank = unlimited" />
          <PrimaryButton data-testid="cap-submit" onClick={submitCap} disabled={busy} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Update Cap
          </PrimaryButton>
        </div>
      </Modal>
    </div>
  );
};
