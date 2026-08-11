import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Coins, Loader2, Landmark, ArrowUpRight, Wallet2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useConsoleApi, fmtCoins, shortId } from "./api";
import { PayrollCard } from "./PayrollCard";
import {
  CARD, thCls, tdCls, PanelHeader, StatCard, PrimaryButton, GhostButton,
  UsageBar, Modal, Field, Spinner, EmptyState,
} from "./primitives";

// Zonal Manager console: my quota/wallet, my Managers, create + fund Managers,
// and set each Manager's admin cap.
export const MyManagersPanel = ({ query = "" }) => {
  const api = useConsoleApi();
  const [alloc, setAlloc] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, m] = await Promise.all([api.get("/admin/zonal/my-allocation"), api.get("/admin/zonal/my-managers")]);
      setAlloc(a.data); setRows(m.data);
    } catch { toast.error("Couldn't load your console"); }
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
      await api.post("/admin/zonal/managers", {
        email: form.email.trim(), password: form.password,
        display_name: form.display_name.trim(), authorized_quota: Number(form.authorized_quota) || 0,
      });
      toast.success("Manager created in your zone"); setModal(null); await load();
    } catch (e) { toast.error("Couldn't create manager", { description: e.response?.data?.detail || "" }); }
    finally { setBusy(false); }
  };
  const submitFund = async () => {
    if (busy) return;
    const amount = Number(form.amount);
    if (!amount || amount <= 0) return toast.error("Enter a positive amount");
    setBusy(true);
    try {
      await api.post("/admin/zonal/fund-manager", { manager_id: modal.row.user.id, amount, request_id: crypto.randomUUID() });
      toast.success(`Funded ${fmtCoins(amount)} coins`); setModal(null); await load();
    } catch (e) { toast.error("Couldn't fund", { description: e.response?.data?.detail || "" }); }
    finally { setBusy(false); }
  };
  const submitCap = async () => {
    if (busy) return; setBusy(true);
    const raw = form.max_admins_allowed;
    const value = raw === "" || raw == null ? null : Number(raw);
    try {
      await api.patch(`/admin/managers/${modal.row.user.id}/max-admins`, { max_admins_allowed: value });
      toast.success("Admin cap updated"); setModal(null); await load();
    } catch (e) { toast.error("Couldn't update cap", { description: e.response?.data?.detail || "" }); }
    finally { setBusy(false); }
  };

  if (loading) return <Spinner label="Loading your console…" />;

  return (
    <div data-testid="my-managers-panel">
      <PanelHeader
        title="My Managers"
        subtitle="Coins you fund flow from your wallet into your Managers' wallets."
        actions={<PrimaryButton data-testid="zm-add-manager-btn" onClick={() => { setForm({ email: "", password: "", display_name: "", authorized_quota: "" }); setModal("create"); }}><Plus className="h-4 w-4" /> Add Manager</PrimaryButton>}
      />

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard testid="zm-quota" icon={Landmark} label="Authorized Quota" value={fmtCoins(alloc?.authorized_quota)} />
        <StatCard testid="zm-allocated" icon={ArrowUpRight} label="Allocated Out" value={fmtCoins(alloc?.allocated_out)} accent="cherry" />
        <StatCard testid="zm-available" icon={Coins} label="Available Quota" value={fmtCoins(alloc?.available_quota)} />
        <StatCard testid="zm-wallet" icon={Wallet2} label="Wallet Balance" value={fmtCoins(alloc?.wallet_balance)} />
      </div>

      <PayrollCard endpoint="/admin/zonal/my-payroll" />

      {filtered.length === 0 ? (
        <EmptyState testid="my-managers-empty" title="No managers yet" subtitle="Create your first Manager, then fund their wallet." />
      ) : (
        <div className={`${CARD} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm" data-testid="my-managers-table">
              <thead><tr className="border-b border-slate-100">
                <th className={thCls}>Manager</th><th className={thCls}>Quota</th><th className={thCls}>Allocated</th>
                <th className={thCls}>Usage</th><th className={thCls}>Admins</th><th className={thCls}>Cap</th>
                <th className={thCls}>Wallet</th><th className={`${thCls} text-right`}>Actions</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r) => (
                  <tr key={r.user.id} data-testid={`zm-manager-row-${r.user.id}`} className="transition-colors hover:bg-slate-50">
                    <td className={tdCls}>
                      <p className="font-bold text-slate-900">{r.user.display_name}</p>
                      <p className="text-[11px] text-slate-400">{r.user.email}</p>
                      <p className="font-mono text-[11px] text-slate-400">{shortId(r.user.id)}</p>
                    </td>
                    <td className={`${tdCls} text-sky-600`}>{fmtCoins(r.authorized_quota)}</td>
                    <td className={tdCls}>{fmtCoins(r.allocated_out)}</td>
                    <td className={tdCls}><UsageBar pct={r.usage_pct} /></td>
                    <td className={tdCls}>{r.admin_count}{r.pending_admin_requests ? <span className="ml-1 text-amber-600">(+{r.pending_admin_requests} pending)</span> : null}</td>
                    <td className={tdCls}>{r.max_admins_allowed == null ? <span className="text-slate-400">∞</span> : r.max_admins_allowed}</td>
                    <td className={tdCls}>{fmtCoins(r.wallet_balance)}</td>
                    <td className={tdCls}>
                      <div className="flex items-center justify-end gap-2">
                        <GhostButton data-testid={`zm-fund-${r.user.id}`} onClick={() => { setForm({ amount: "" }); setModal({ type: "fund", row: r }); }} className="!px-3 !py-2 text-xs"><Wallet2 className="h-3.5 w-3.5" /> Fund</GhostButton>
                        <GhostButton data-testid={`zm-cap-${r.user.id}`} onClick={() => { setForm({ max_admins_allowed: r.max_admins_allowed ?? "" }); setModal({ type: "cap", row: r }); }} className="!px-3 !py-2 text-xs"><ShieldCheck className="h-3.5 w-3.5" /> Cap</GhostButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={modal === "create"} onClose={() => setModal(null)} title="Add Manager to your zone" testid="zm-create-manager-modal">
        <div className="space-y-4">
          <Field label="Display name" data-testid="zcm-name" value={form.display_name || ""} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} />
          <Field label="Email" type="email" data-testid="zcm-email" value={form.email || ""} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="manager@royal11.com" />
          <Field label="Password" type="password" data-testid="zcm-password" value={form.password || ""} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} hint="Minimum 8 characters" />
          <Field label="Authorized quota" type="number" data-testid="zcm-quota" value={form.authorized_quota ?? ""} onChange={(e) => setForm((f) => ({ ...f, authorized_quota: e.target.value }))} hint="Max coins this Manager may push down to Admins" />
          <PrimaryButton data-testid="zcm-submit" onClick={submitCreate} disabled={busy || !form.email || !form.password || !form.display_name} className="w-full">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create Manager</PrimaryButton>
        </div>
      </Modal>

      <Modal open={modal?.type === "fund"} onClose={() => setModal(null)} title={`Fund ${modal?.row?.user.display_name || ""}`} testid="zm-fund-modal">
        <div className="space-y-4">
          <p className="text-xs text-slate-400">Moves coins from your wallet ({fmtCoins(alloc?.wallet_balance)} available) into this Manager's wallet. Counts against your quota.</p>
          <Field label="Amount" type="number" data-testid="zm-fund-amount" value={form.amount || ""} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="e.g. 100000" />
          <PrimaryButton data-testid="zm-fund-submit" onClick={submitFund} disabled={busy} className="w-full">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet2 className="h-4 w-4" />} Fund Wallet</PrimaryButton>
        </div>
      </Modal>

      <Modal open={modal?.type === "cap"} onClose={() => setModal(null)} title={`Admin cap — ${modal?.row?.user.display_name || ""}`} testid="zm-cap-modal">
        <div className="space-y-4">
          <p className="text-xs text-slate-400">Max number of Admins this Manager may have (existing + pending requests). Leave blank for unlimited.</p>
          <Field label="Max admins" type="number" data-testid="zm-cap-input" value={form.max_admins_allowed ?? ""} onChange={(e) => setForm((f) => ({ ...f, max_admins_allowed: e.target.value }))} placeholder="Blank = unlimited" />
          <PrimaryButton data-testid="zm-cap-submit" onClick={submitCap} disabled={busy} className="w-full">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Update Cap</PrimaryButton>
        </div>
      </Modal>
    </div>
  );
};
