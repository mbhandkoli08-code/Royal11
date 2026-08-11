import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, Plus, Landmark, CheckCircle2, QrCode } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useConsoleApi, fmtCoins } from "./api";
import { CARD, PanelHeader, PrimaryButton, GhostButton, Modal, Field, Spinner, EmptyState } from "./primitives";
import { Switch } from "@/components/ui/switch";
import { buildUpiUri } from "@/lib/upi";

const EMPTY = { account_holder_name: "", account_number: "", ifsc: "", bank_name: "", upi_id: "" };

// Admin/Manager manage MULTIPLE collection accounts; exactly one is active and
// that's what players see (with its auto-generated UPI QR). Old accounts stay
// visible with their running CONFIRMED-deposit totals.
export const BankAccountPanel = () => {
  const api = useConsoleApi();
  const { user } = useAuth();
  const suspended = user?.status === "SUSPENDED";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/bank-accounts");
      setRows(data);
    } catch { toast.error("Couldn't load bank accounts"); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = async () => {
    if (busy) return;
    if (!form.account_holder_name || !form.account_number || !form.ifsc || !form.bank_name)
      return toast.error("Please fill account holder, number, IFSC and bank name");
    setBusy(true);
    try {
      await api.post("/admin/bank-accounts", {
        account_holder_name: form.account_holder_name.trim(),
        account_number: form.account_number.trim(),
        ifsc: form.ifsc.trim().toUpperCase(),
        bank_name: form.bank_name.trim(),
        upi_id: form.upi_id.trim() || null,
      });
      toast.success("Bank account added");
      setModal(false); setForm(EMPTY);
      await load();
    } catch (e) { toast.error("Couldn't add account", { description: e.response?.data?.detail || "" }); }
    finally { setBusy(false); }
  };

  const activate = async (acc) => {
    if (busy || acc.is_active) return;
    setBusy(true);
    try {
      await api.patch(`/admin/bank-accounts/${acc.id}/activate`);
      toast.success(`${acc.bank_name} is now the active account`);
      await load();
    } catch (e) { toast.error("Couldn't activate", { description: e.response?.data?.detail || "" }); }
    finally { setBusy(false); }
  };

  if (loading) return <Spinner label="Loading bank accounts…" />;

  return (
    <div data-testid="bank-account-panel">
      <PanelHeader
        title="Collection Bank Accounts"
        subtitle="Add multiple accounts; the active one is shown to players (with its UPI QR). Totals below are from confirmed deposits."
        actions={<PrimaryButton data-testid="bank-add-btn" disabled={suspended} onClick={() => { setForm(EMPTY); setModal(true); }}><Plus className="h-4 w-4" /> Add Account</PrimaryButton>}
      />

      {rows.length === 0 ? (
        <EmptyState testid="bank-empty" title="No bank accounts yet" subtitle="Add your first collection account — it becomes the active one automatically." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2" data-testid="bank-accounts-list">
          {rows.map((a) => {
            const uri = buildUpiUri(a.upi_id, a.account_holder_name);
            return (
              <div key={a.id} data-testid={`bank-card-${a.id}`} className={`${CARD} p-5 ${a.is_active ? "ring-2 ring-sky-300" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-sky-50 text-sky-600"><Landmark className="h-5 w-5" /></span>
                    <div>
                      <p className="font-bold text-slate-900">{a.bank_name}</p>
                      <p className="text-[11px] text-slate-400">{a.account_holder_name}</p>
                    </div>
                  </div>
                  {a.is_active
                    ? <span data-testid={`bank-active-badge-${a.id}`} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> Active</span>
                    : <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">Inactive</span>}
                </div>

                <div className="mt-4 flex gap-4">
                  <div className="min-w-0 flex-1 space-y-1.5 text-sm">
                    <p className="text-slate-700"><span className="text-slate-400">A/C:</span> {a.account_number}</p>
                    <p className="text-slate-700"><span className="text-slate-400">IFSC:</span> {a.ifsc}</p>
                    <p className="truncate text-slate-700"><span className="text-slate-400">UPI:</span> {a.upi_id || <span className="text-slate-400">—</span>}</p>
                  </div>
                  {uri && (
                    <div className="shrink-0 rounded-xl border border-slate-100 bg-white p-2" data-testid={`bank-qr-${a.id}`}>
                      <QRCodeSVG value={uri} size={84} level="M" />
                    </div>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-slate-50 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">This week</p>
                    <p className="font-display text-lg font-bold text-slate-900">₹{fmtCoins(a.confirmed_total_week)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">All-time</p>
                    <p className="font-display text-lg font-bold text-slate-900">₹{fmtCoins(a.confirmed_total_all_time)}</p>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                  <span className="text-xs font-semibold text-slate-500">{a.is_active ? "Shown to players" : "Set as active"}</span>
                  <Switch data-testid={`bank-toggle-${a.id}`} checked={a.is_active} disabled={busy || suspended || a.is_active} onCheckedChange={() => activate(a)} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {suspended && <p className="mt-4 text-xs text-rose-600">Your account is suspended — adding/activating is disabled until reinstated.</p>}

      <Modal open={modal} onClose={() => setModal(false)} title="Add collection account" testid="bank-add-modal">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Account holder name" data-testid="bank-holder" value={form.account_holder_name} onChange={set("account_holder_name")} />
            <Field label="Bank name" data-testid="bank-name" value={form.bank_name} onChange={set("bank_name")} />
            <Field label="Account number" data-testid="bank-number" value={form.account_number} onChange={set("account_number")} />
            <Field label="IFSC" data-testid="bank-ifsc" value={form.ifsc} onChange={set("ifsc")} />
          </div>
          <Field label="UPI ID (optional)" data-testid="bank-upi" value={form.upi_id} onChange={set("upi_id")} placeholder="name@okicici" hint="A scannable UPI QR is generated automatically from this ID." />
          {buildUpiUri(form.upi_id.trim(), form.account_holder_name) && (
            <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3" data-testid="bank-upi-preview">
              <div className="rounded-lg bg-white p-1.5"><QRCodeSVG value={buildUpiUri(form.upi_id.trim(), form.account_holder_name)} size={64} level="M" /></div>
              <p className="text-xs text-slate-500"><QrCode className="mb-1 h-4 w-4 text-sky-500" /> Live QR preview — this is what players scan.</p>
            </div>
          )}
          <PrimaryButton data-testid="bank-create-submit" onClick={create} disabled={busy} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add Account
          </PrimaryButton>
        </div>
      </Modal>
    </div>
  );
};
