import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CreditCard, Wallet, AlertTriangle } from "lucide-react";
import { useConsoleApi, fmtCoins } from "@/console/api";
import { CARD, PanelHeader, Spinner, PrimaryButton, Modal, Field } from "@/console/primitives";

// An Admin's own credit-line status + a way to request more headroom.
export const AdminMyCreditPanel = () => {
  const api = useConsoleApi();
  const [s, setS] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.get("/admin-credit/me"); setS(data); }
    catch { toast.error("Couldn't load credit status"); }
    setLoading(false);
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const request = async () => {
    if (!Number(amount)) return toast.error("Enter an amount");
    setBusy(true);
    try {
      await api.post("/admin-credit/request", { amount: Number(amount), reason: reason || undefined });
      toast.success("Request sent to your Manager");
      setOpen(false); setAmount(""); setReason(""); await load();
    } catch (e) { toast.error(e.response?.data?.detail || "Couldn't send request"); }
    setBusy(false);
  };

  if (loading) return <Spinner />;

  return (
    <div data-testid="my-credit-panel">
      <PanelHeader title="My Credit Line" subtitle="Your working-float credit — used automatically when your balance runs short" />

      {s?.low_float_warning && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4" data-testid="my-credit-warning">
          <AlertTriangle className="h-6 w-6 shrink-0 text-amber-600" />
          <p className="text-sm font-semibold text-amber-800">Your float is empty — recharges are now running on credit. Refill soon to avoid interruptions.</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className={`${CARD} p-5`}><Wallet className="h-5 w-5 text-slate-400" /><p className="mt-2 text-2xl font-black text-slate-900" data-testid="my-credit-float">{fmtCoins(s.float_balance)}</p><p className="text-xs text-slate-500">Float balance</p></div>
        <div className={`${CARD} p-5`}><CreditCard className="h-5 w-5 text-slate-400" /><p className="mt-2 text-2xl font-black text-slate-900" data-testid="my-credit-limit">{fmtCoins(s.credit_limit)}</p><p className="text-xs text-slate-500">Credit limit</p></div>
        <div className={`${CARD} p-5`}><p className="mt-7 text-2xl font-black text-rose-600" data-testid="my-credit-debt">{fmtCoins(s.outstanding_debt)}</p><p className="text-xs text-slate-500">Outstanding debt</p></div>
        <div className={`${CARD} p-5`}><p className="mt-7 text-2xl font-black text-emerald-600" data-testid="my-credit-available">{fmtCoins(s.available_credit)}</p><p className="text-xs text-slate-500">Available credit</p></div>
      </div>

      <div className="mt-5">
        <PrimaryButton data-testid="my-credit-request-btn" onClick={() => setOpen(true)}>Request more credit</PrimaryButton>
        <p className="mt-2 text-xs text-slate-400">Requests above your remaining limit need Manager approval.</p>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Request more credit" testid="my-credit-request-modal">
        <div className="space-y-4">
          <Field label="Amount (coins)" type="number" data-testid="my-credit-amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
          <Field label="Reason (optional)" data-testid="my-credit-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Match-day rush" />
          <PrimaryButton data-testid="my-credit-request-submit" className="w-full" disabled={busy} onClick={request}>Send request</PrimaryButton>
        </div>
      </Modal>
    </div>
  );
};
