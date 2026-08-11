import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Coins, Loader2, Landmark, ArrowUpRight, Wallet2 } from "lucide-react";
import { toast } from "sonner";
import { useConsoleApi, fmtCoins, shortId } from "./api";
import {
  CARD, thCls, tdCls, PanelHeader, StatCard, PrimaryButton, GhostButton,
  UsageBar, UsageBadge, Modal, Field, Spinner, EmptyState,
} from "./primitives";

// Manager console: my quota, my admins, create admin, allocate coins to admins.
export const MyAdminsPanel = ({ query = "" }) => {
  const api = useConsoleApi();
  const [alloc, setAlloc] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // "create" | {type:"allocate", row}
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, m] = await Promise.all([api.get("/admin/my-allocation"), api.get("/admin/my-admins")]);
      setAlloc(a.data);
      setRows(m.data);
    } catch {
      toast.error("Couldn't load your console");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.user.display_name.toLowerCase().includes(q) || r.user.email.toLowerCase().includes(q) || r.user.id.includes(q));
  }, [rows, query]);

  const openCreate = () => { setForm({ email: "", password: "", display_name: "", player_capacity: 50 }); setModal("create"); };
  const openAllocate = (row) => { setForm({ amount: "" }); setModal({ type: "allocate", row }); };

  const submitCreate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post("/admin/admin-requests", {
        email: form.email.trim(), password: form.password,
        display_name: form.display_name.trim(),
        player_capacity: Number(form.player_capacity) || 0,
      });
      toast.success("Request submitted", { description: "Your Zonal Manager / Super Admin will approve it." });
      setModal(null);
      await load();
    } catch (e) {
      toast.error("Couldn't submit request", { description: e.response?.data?.detail || "" });
    } finally { setBusy(false); }
  };

  const submitAllocate = async () => {
    if (busy) return;
    const amount = Number(form.amount);
    if (!amount || amount <= 0) return toast.error("Enter a positive amount");
    setBusy(true);
    try {
      await api.post("/admin/allocate", { admin_id: modal.row.user.id, amount, request_id: crypto.randomUUID() });
      toast.success(`Allocated ${fmtCoins(amount)} coins`);
      setModal(null);
      await load();
    } catch (e) {
      toast.error("Couldn't allocate", { description: e.response?.data?.detail || "" });
    } finally { setBusy(false); }
  };

  if (loading) return <Spinner label="Loading your console…" />;

  return (
    <div data-testid="my-admins-panel">
      <PanelHeader
        title="My Admins"
        subtitle={
          alloc?.max_admins_allowed != null
            ? `Admin requests need approval. Cap: ${alloc.admin_count}/${alloc.max_admins_allowed} used${alloc.pending_admin_requests ? ` · ${alloc.pending_admin_requests} pending` : ""}.`
            : "New Admins are requested here and approved by your Zonal Manager / Super Admin."
        }
        actions={<PrimaryButton data-testid="add-admin-btn" onClick={openCreate}><Plus className="h-4 w-4" /> Request New Admin</PrimaryButton>}
      />

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard testid="mgr-quota" icon={Landmark} label="Authorized Quota" value={fmtCoins(alloc?.authorized_quota)} />
        <StatCard testid="mgr-allocated" icon={ArrowUpRight} label="Allocated Out" value={fmtCoins(alloc?.allocated_out)} accent="cherry" />
        <StatCard testid="mgr-available" icon={Coins} label="Available Quota" value={fmtCoins(alloc?.available_quota)} />
        <StatCard testid="mgr-wallet" icon={Wallet2} label="Wallet Balance" value={fmtCoins(alloc?.wallet_balance)} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState testid="my-admins-empty" title="No admins yet" subtitle="Create your first Admin, then allocate coins to them." />
      ) : (
        <div className={`${CARD} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm" data-testid="my-admins-table">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className={thCls}>Admin</th>
                  <th className={thCls}>Allocated</th>
                  <th className={thCls}>Used</th>
                  <th className={thCls}>Usage</th>
                  <th className={thCls}>Players</th>
                  <th className={thCls}>Wallet</th>
                  <th className={`${thCls} text-right`}>Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r) => (
                  <tr key={r.user.id} data-testid={`my-admin-row-${r.user.id}`} className="transition-colors hover:bg-slate-50">
                    <td className={tdCls}>
                      <p className="font-bold text-slate-900">{r.user.display_name}</p>
                      <p className="text-[11px] text-slate-400">{r.user.email}</p>
                      <p className="font-mono text-[11px] text-slate-400">{shortId(r.user.id)}</p>
                    </td>
                    <td className={`${tdCls} text-sky-600`}>{fmtCoins(r.allocated)}</td>
                    <td className={tdCls}>{fmtCoins(r.used)}</td>
                    <td className={tdCls}><div className="flex items-center"><UsageBar pct={r.usage_pct} /><UsageBadge level={r.usage_level} /></div></td>
                    <td className={tdCls}>{r.player_count}<span className="text-slate-400"> / {r.player_capacity}</span></td>
                    <td className={tdCls}>{fmtCoins(r.wallet_balance)}</td>
                    <td className={tdCls}>
                      <div className="flex justify-end">
                        <GhostButton data-testid={`allocate-${r.user.id}`} onClick={() => openAllocate(r)} className="!px-3 !py-2 text-xs"><Coins className="h-3.5 w-3.5" /> Allocate</GhostButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={modal === "create"} onClose={() => setModal(null)} title="Request New Admin" testid="create-admin-modal">
        <div className="space-y-4">
          <p className="text-xs text-slate-400">Submitting sends this to your Zonal Manager (or Super Admin) for approval. The account is created only once approved.</p>
          <Field label="Display name" data-testid="ca-name" value={form.display_name || ""} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} />
          <Field label="Email" type="email" data-testid="ca-email" value={form.email || ""} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="admin@royal11.com" />
          <Field label="Password" type="password" data-testid="ca-password" value={form.password || ""} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} hint="Minimum 8 characters" />
          <Field label="Player capacity" type="number" data-testid="ca-capacity" value={form.player_capacity ?? ""} onChange={(e) => setForm((f) => ({ ...f, player_capacity: e.target.value }))} hint="Max players this Admin can manage" />
          <PrimaryButton data-testid="ca-submit" onClick={submitCreate} disabled={busy || !form.email || !form.password || !form.display_name} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Submit Request
          </PrimaryButton>
        </div>
      </Modal>

      <Modal open={modal?.type === "allocate"} onClose={() => setModal(null)} title={`Allocate to ${modal?.row?.user.display_name || ""}`} testid="allocate-modal">
        <div className="space-y-4">
          <p className="text-xs text-slate-400">Moves coins from your wallet ({fmtCoins(alloc?.wallet_balance)} available) into this Admin’s wallet. Counts against your quota.</p>
          <Field label="Amount" type="number" data-testid="allocate-amount" value={form.amount || ""} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="e.g. 10000" />
          <PrimaryButton data-testid="allocate-submit" onClick={submitAllocate} disabled={busy} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />} Allocate Coins
          </PrimaryButton>
        </div>
      </Modal>
    </div>
  );
};
