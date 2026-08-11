import { useCallback, useEffect, useState } from "react";
import { Zap, Loader2, Landmark, Info } from "lucide-react";
import { toast } from "sonner";
import { useConsoleApi, fmtCoins, fmtDate } from "./api";
import { CARD, PanelHeader, PrimaryButton, Field, StatusBadge, Spinner, EmptyState } from "./primitives";

// Admin self-recharge: Admin pays Super Admin directly to top up their own
// quota at a bonus rate. Allowed even when suspended (path back to active).
export const RechargePanel = () => {
  const api = useConsoleApi();
  const [rows, setRows] = useState([]);
  const [rate, setRate] = useState(1.5);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, info] = await Promise.all([api.get("/admin/my-recharges"), api.get("/admin/recharge-info")]);
      setRows(r.data);
      setRate(info.data.bonus_rate);
    } catch {
      toast.error("Couldn't load recharges");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");
    if (!ref.trim()) return toast.error("Enter your payment reference / UTR");
    setBusy(true);
    try {
      await api.post("/admin/recharge-request", { amount_inr: amt, reference_note: ref.trim() });
      toast.success("Recharge request sent", { description: "Super Admin will confirm after verifying payment." });
      setAmount(""); setRef("");
      await load();
    } catch (e) {
      toast.error("Couldn't submit", { description: e.response?.data?.detail || "" });
    } finally { setBusy(false); }
  };

  return (
    <div data-testid="recharge-panel">
      <PanelHeader title="Recharge Quota" subtitle={`Pay the Super Admin directly to top up your coins at ${rate}x bonus.`} />

      <div className="mb-6 flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-700">
        <Info className="h-4 w-4 shrink-0" />
        Example: pay ₹100 → receive {fmtCoins(Math.round(100 * rate))} coins. This is separate from your Manager's allocation.
      </div>

      <div className={`${CARD} mb-8 max-w-lg p-6`}>
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Landmark className="h-4 w-4 text-sky-600" /> Submit a recharge request
        </div>
        <div className="space-y-3">
          <Field label="Amount (₹)" type="number" data-testid="recharge-amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 100" />
          <Field label="Payment reference / UTR" data-testid="recharge-reference" value={ref} onChange={(e) => setRef(e.target.value)} />
          {amount > 0 && (
            <p className="text-xs font-semibold text-slate-500">You'll receive <span className="text-sky-600">{fmtCoins(Math.round(Number(amount) * rate))} coins</span> after Super Admin confirms.</p>
          )}
          <PrimaryButton data-testid="recharge-submit" onClick={submit} disabled={busy} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Submit Recharge
          </PrimaryButton>
        </div>
      </div>

      <h2 className="mb-4 font-display text-lg font-bold tracking-tight text-slate-900">Your recharge requests</h2>
      {loading ? <Spinner /> : rows.length === 0 ? (
        <EmptyState testid="recharge-empty" title="No recharges yet" subtitle="Submit one above to top up your quota." />
      ) : (
        <div className="space-y-2" data-testid="my-recharges">
          {rows.map((r) => (
            <div key={r.id} data-testid={`my-recharge-${r.id}`} className={`${CARD} flex items-center justify-between p-4`}>
              <div>
                <p className="font-display text-lg font-bold text-slate-900">₹{fmtCoins(r.amount_inr)} <span className="text-sm font-medium text-slate-400">→ {fmtCoins(r.coins_credited)} coins</span></p>
                <p className="text-xs text-slate-400">Ref: {r.reference_note} · {fmtDate(r.created_at)}</p>
                {r.rejected_reason && <p className="mt-0.5 text-xs font-medium text-rose-600">Rejected: {r.rejected_reason}</p>}
              </div>
              <StatusBadge status={r.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
