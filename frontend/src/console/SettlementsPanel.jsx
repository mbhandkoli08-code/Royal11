import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, CalendarClock, Building2, Save, FileImage, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useConsoleApi, fmtCoins } from "./api";
import { CARD, thCls, tdCls, PanelHeader, PrimaryButton, StatusBadge, Modal, Spinner, EmptyState, Field } from "./primitives";
import { AuthImage } from "./AuthImage";

// Super Admin weekly settlements. Amounts in ₹. Overdue PENDING settlements
// auto-suspend the Admin (handled server-side); settling here lifts that.
export const SettlementsPanel = ({ query = "" }) => {
  const api = useConsoleApi();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [bank, setBank] = useState(null);
  const [savingBank, setSavingBank] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, b] = await Promise.all([
        api.get("/admin/settlements"),
        api.get("/superadmin/settlement/company-bank"),
      ]);
      setRows(s.data); setBank(b.data);
    } catch {
      toast.error("Couldn't load settlements");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const saveBank = async () => {
    setSavingBank(true);
    try {
      const { data } = await api.put("/superadmin/settlement/company-bank", bank);
      setBank(data);
      toast.success("Company remittance account saved");
    } catch { toast.error("Couldn't save account"); } finally { setSavingBank(false); }
  };

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

      {/* Company remittance account (where Admins pay their settlement) */}
      {bank && (
        <div className={`${CARD} mb-5 p-5`} data-testid="company-bank-card">
          <p className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900"><Building2 className="h-4 w-4 text-sky-600" /> Company remittance account <span className="text-xs font-normal text-slate-400">(shown to Admins on their Settle Now screen)</span></p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Account holder" data-testid="company-account-name" value={bank.account_name || ""} onChange={(e) => setBank((b) => ({ ...b, account_name: e.target.value }))} />
            <Field label="Bank name" data-testid="company-bank-name" value={bank.bank_name || ""} onChange={(e) => setBank((b) => ({ ...b, bank_name: e.target.value }))} />
            <Field label="Account number" data-testid="company-account-number" value={bank.account_number || ""} onChange={(e) => setBank((b) => ({ ...b, account_number: e.target.value }))} />
            <Field label="IFSC" data-testid="company-ifsc" value={bank.ifsc || ""} onChange={(e) => setBank((b) => ({ ...b, ifsc: e.target.value }))} />
            <Field label="UPI ID" data-testid="company-upi" value={bank.upi_id || ""} onChange={(e) => setBank((b) => ({ ...b, upi_id: e.target.value }))} />
            <Field label="Notes" data-testid="company-notes" value={bank.notes || ""} onChange={(e) => setBank((b) => ({ ...b, notes: e.target.value }))} />
          </div>
          <PrimaryButton data-testid="company-bank-save" onClick={saveBank} disabled={savingBank} className="mt-3">
            {savingBank ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save account
          </PrimaryButton>
        </div>
      )}

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
                          {s.status !== "SETTLED" ? (
                            <PrimaryButton data-testid={`settle-${s.id}`} onClick={() => setTarget(s)} className="!px-3 !py-2 text-xs !bg-emerald-600">
                              <CheckCircle2 className="h-3.5 w-3.5" /> {s.status === "SUBMITTED" ? "Confirm Paid" : "Mark Settled"}
                            </PrimaryButton>
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

      <Modal open={!!target} onClose={() => setTarget(null)} title="Confirm settlement payment" testid="settle-modal">
        <div className="space-y-4">
          <p className="text-xs text-slate-400">
            Confirm you&apos;ve received <span className="font-bold text-sky-600">₹{fmtCoins(target?.super_admin_share_inr)}</span> from
            <span className="font-bold text-slate-900"> {target?.admin_name}</span> for the week {target?.week_start} → {target?.week_end}. This lifts any settlement-overdue suspension.
          </p>
          {target?.payment_reference && <p className="text-xs text-slate-500">Payment reference: <span className="font-mono font-semibold text-slate-800">{target.payment_reference}</span></p>}
          {target?.has_proof && (
            <div>
              <p className="mb-1 flex items-center gap-1 text-xs text-slate-500"><FileImage className="h-3.5 w-3.5" /> Payment proof</p>
              <AuthImage path={`/superadmin/settlement/proof/${target.id}`} alt="Proof" className="max-h-64 w-full rounded-xl object-contain bg-slate-50" testid="settlement-proof-img" />
            </div>
          )}
          {target && !target.has_proof && target.status === "PENDING" && (
            <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> No proof submitted by the Admin yet — you can still mark it paid directly.</p>
          )}
          <PrimaryButton data-testid="settle-confirm" onClick={settle} disabled={busy} className="w-full !bg-emerald-600">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Confirm Paid
          </PrimaryButton>
        </div>
      </Modal>
    </div>
  );
};
