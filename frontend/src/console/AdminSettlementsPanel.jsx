import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Landmark, Upload, AlertTriangle, CheckCircle2, Copy, Check, FileText } from "lucide-react";
import { useConsoleApi, fmtCoins, fmtDate } from "@/console/api";
import { PanelHeader, Field, PrimaryButton, Spinner, Modal, CARD, thCls, tdCls, StatusBadge, EmptyState } from "@/console/primitives";

// ADMIN: their own weekly settlements + Settle Now (bank instructions + proof).
export const AdminSettlementsPanel = () => {
  const api = useConsoleApi();
  const [rows, setRows] = useState([]);
  const [bank, setBank] = useState(null);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState(null);
  const [reference, setReference] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, b] = await Promise.all([
        api.get("/admin/settlement/my"),
        api.get("/admin/settlement/company-bank"),
      ]);
      setRows(s.data); setBank(b.data);
    } catch { toast.error("Couldn't load settlements"); } finally { setLoading(false); }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!reference.trim() && !file) return toast.error("Add a payment reference or screenshot as proof");
    const fd = new FormData();
    if (reference.trim()) fd.append("reference", reference.trim());
    if (file) fd.append("screenshot", file);
    setBusy(true);
    try {
      await api.post(`/admin/settlement/${target.id}/pay`, fd);
      toast.success("Payment proof submitted", { description: "Super Admin will confirm shortly." });
      setTarget(null); setReference(""); setFile(null);
      await load();
    } catch (e) { toast.error("Couldn't submit", { description: e.response?.data?.detail || "" }); }
    finally { setBusy(false); }
  };

  const copyAcct = () => {
    if (!bank?.account_number) return;
    navigator.clipboard?.writeText(bank.account_number);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  const downloadStatement = async (s) => {
    try {
      const { data } = await api.get(`/admin/settlement/${s.id}/statement.pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url; link.download = `settlement_${s.week_start}.pdf`; link.click();
      URL.revokeObjectURL(url);
    } catch { toast.error("Couldn't download statement"); }
  };

  if (loading) return <Spinner label="Loading your settlements…" />;

  const overdue = rows.filter((s) => s.is_overdue);
  const suspendedGrace = overdue.some((s) => !s.in_grace);

  return (
    <div data-testid="admin-settlements-panel">
      <PanelHeader title="My Settlements" subtitle="Your weekly revenue-share dues to the company (Sun–Sat). Settle before the due date to keep your account active." />

      {overdue.length > 0 && (
        <div data-testid="settlement-warning" className={`mb-5 flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm ${suspendedGrace ? "border-rose-200 bg-rose-50 text-rose-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{suspendedGrace
            ? "A settlement is overdue past the grace period — your account may be suspended until you settle. Pay now to restore access."
            : `You have an overdue settlement in its grace period. Please settle before ${fmtDate(overdue[0].grace_ends)} to avoid suspension.`}</span>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState testid="admin-settlements-empty" title="No settlements yet" subtitle="Settlements appear after a week that had confirmed deposits." />
      ) : (
        <div className={`${CARD} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm" data-testid="admin-settlements-table">
              <thead><tr className="border-b border-slate-100 bg-slate-50/60">
                <th className={thCls}>Week</th><th className={thCls}>Gross deposits</th><th className={thCls}>Your share</th>
                <th className={thCls}>Net to remit</th><th className={thCls}>Due</th><th className={thCls}>Status</th><th className={`${thCls} text-right`}>Action</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((s) => (
                  <tr key={s.id} data-testid={`admin-settlement-${s.id}`} className="hover:bg-slate-50">
                    <td className={`${tdCls} text-xs text-slate-500`}>{s.week_start} → {s.week_end}</td>
                    <td className={tdCls}>₹{fmtCoins(s.total_deposits_inr)}</td>
                    <td className={tdCls}>₹{fmtCoins(s.admin_share_inr)}</td>
                    <td className={`${tdCls} font-bold text-sky-600`}>₹{fmtCoins(s.net_to_remit_inr)}</td>
                    <td className={tdCls}><span className={`text-xs font-semibold ${s.is_overdue ? "text-rose-600" : "text-slate-400"}`}>{s.due_date}</span></td>
                    <td className={tdCls}><StatusBadge status={s.status} /></td>
                    <td className={tdCls}>
                      <div className="flex items-center justify-end gap-2">
                        <button data-testid={`statement-${s.id}`} onClick={() => downloadStatement(s)} title="Download statement PDF"
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"><FileText className="h-3.5 w-3.5" /> PDF</button>
                        {s.status === "PENDING" ? (
                          <PrimaryButton data-testid={`settle-now-${s.id}`} onClick={() => setTarget(s)} className="!px-3 !py-2 text-xs">Settle Now</PrimaryButton>
                        ) : <span className="text-xs text-slate-400">{s.status === "SUBMITTED" ? "Awaiting confirm" : "—"}</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={!!target} onClose={() => setTarget(null)} title="Settle Now" testid="settle-now-modal">
        <div className="space-y-4">
          <div className="rounded-xl bg-sky-50 px-3 py-2 text-sm">
            Remit <span className="font-bold text-sky-700">₹{fmtCoins(target?.net_to_remit_inr)}</span> for the week {target?.week_start} → {target?.week_end}.
          </div>
          {/* Company bank instructions */}
          <div className="rounded-xl border border-slate-200 p-3 text-sm" data-testid="settle-bank-details">
            <p className="mb-2 flex items-center gap-1.5 font-bold text-slate-900"><Landmark className="h-4 w-4 text-slate-500" /> Pay to company account</p>
            {bank?.account_number ? (
              <div className="space-y-1 text-xs text-slate-600">
                <p>Holder: <b className="text-slate-900">{bank.account_name || "—"}</b></p>
                <p>Bank: <b className="text-slate-900">{bank.bank_name || "—"}</b></p>
                <p className="flex items-center gap-2">A/C: <b className="text-slate-900">{bank.account_number}</b>
                  <button onClick={copyAcct} className="grid h-6 w-6 place-items-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50">{copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}</button>
                </p>
                <p>IFSC: <b className="text-slate-900">{bank.ifsc || "—"}</b></p>
                {bank.upi_id && <p>UPI: <b className="text-slate-900">{bank.upi_id}</b></p>}
                {bank.notes && <p className="text-slate-400">{bank.notes}</p>}
              </div>
            ) : <p className="text-xs text-amber-600">The company hasn&apos;t published a remittance account yet — please contact your manager.</p>}
          </div>
          {/* Proof */}
          <Field label="Payment reference / UTR" data-testid="settle-reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Bank transfer reference" />
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-500">Proof screenshot (optional)</span>
            <input data-testid="settle-screenshot" type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-xs file:font-semibold" />
            {file && <span className="mt-1 block text-[11px] text-emerald-600">{file.name}</span>}
          </label>
          <PrimaryButton data-testid="settle-submit-proof" onClick={submit} disabled={busy} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Submit payment proof
          </PrimaryButton>
        </div>
      </Modal>
    </div>
  );
};
