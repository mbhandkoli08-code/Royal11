import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { UserPlus, Headset, Power } from "lucide-react";
import { useConsoleApi, fmtDate } from "@/console/api";
import { CARD, PanelHeader, Spinner, EmptyState, PrimaryButton, Modal, Field } from "@/console/primitives";

export const SupportTeamPanel = () => {
  const api = useConsoleApi();
  const [helpers, setHelpers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", display_name: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.get("/support/admin/helpers"); setHelpers(data); }
    catch { toast.error("Couldn't load support team"); }
    setLoading(false);
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!form.email || form.password.length < 8 || !form.display_name) {
      return toast.error("Fill all fields (password ≥ 8 chars)");
    }
    setBusy(true);
    try {
      await api.post("/support/admin/helpers", form);
      toast.success("Support Helper added");
      setOpen(false); setForm({ email: "", password: "", display_name: "" });
      await load();
    } catch (e) { toast.error(e.response?.data?.detail || "Couldn't create helper"); }
    setBusy(false);
  };

  const toggle = async (h) => {
    const next = h.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
    try { await api.put(`/support/admin/helpers/${h.id}/status`, { status: next }); await load(); }
    catch (e) { toast.error(e.response?.data?.detail || "Couldn't update"); }
  };

  return (
    <div data-testid="support-team-panel">
      <PanelHeader
        title="Support Team"
        subtitle="Add helpers who can answer tickets on your behalf — they cannot touch payouts, balances or settings"
        actions={<PrimaryButton data-testid="add-helper-btn" onClick={() => setOpen(true)}><UserPlus className="h-4 w-4" /> Add Helper</PrimaryButton>}
      />

      {loading ? <Spinner /> : helpers.length === 0 ? (
        <EmptyState title="No support helpers yet" subtitle="Add a helper to build your support team" testid="support-team-empty" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {helpers.map((h) => (
            <div key={h.id} data-testid={`helper-${h.id}`} className={`${CARD} p-4`}>
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-sky-50 text-sky-600"><Headset className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">{h.display_name}</p>
                  <p className="truncate text-xs text-slate-500">{h.email}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold ${h.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{h.status}</span>
                <button data-testid={`helper-toggle-${h.id}`} onClick={() => toggle(h)}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${h.status === "ACTIVE" ? "bg-rose-50 text-rose-600 hover:bg-rose-100" : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"}`}>
                  <Power className="h-3.5 w-3.5" /> {h.status === "ACTIVE" ? "Disable" : "Enable"}
                </button>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">Added {fmtDate(h.created_at)}</p>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Add Support Helper" testid="add-helper-modal">
        <div className="space-y-4">
          <Field label="Name" data-testid="helper-name" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} placeholder="Support agent name" />
          <Field label="Email" type="email" data-testid="helper-email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="agent@example.com" />
          <Field label="Password" type="password" data-testid="helper-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} hint="Minimum 8 characters" placeholder="••••••••" />
          <PrimaryButton data-testid="helper-create-submit" className="w-full" disabled={busy} onClick={create}>Create Helper</PrimaryButton>
        </div>
      </Modal>
    </div>
  );
};
