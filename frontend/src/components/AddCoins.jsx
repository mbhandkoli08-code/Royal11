import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Landmark, Copy, Loader2, Plus, Coins, Clock, CheckCircle2, XCircle } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const fmt = (n) => (n ?? 0).toLocaleString("en-IN");

const STATUS = {
  PENDING: { cls: "bg-amber-100 text-amber-700", icon: Clock, label: "Pending review" },
  CONFIRMED: { cls: "bg-emerald-100 text-emerald-700", icon: CheckCircle2, label: "Confirmed" },
  REJECTED: { cls: "bg-red-100 text-red-600", icon: XCircle, label: "Rejected" },
};

const Row = ({ label, value }) => (
  <div className="flex items-center justify-between gap-3 py-1.5">
    <span className="text-xs font-medium text-slate-500">{label}</span>
    <div className="flex items-center gap-2">
      <span className="text-sm font-bold text-slate-900">{value}</span>
      <button
        data-testid={`copy-${label}`}
        onClick={() => { navigator.clipboard?.writeText(String(value)); toast("Copied"); }}
        className="text-slate-400 transition-colors hover:text-royal"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  </div>
);

export const AddCoins = ({ open, onClose, onSubmitted }) => {
  const { token } = useAuth();
  const authHeader = { headers: { Authorization: `Bearer ${token}` } };
  const [info, setInfo] = useState(null);
  const [deposits, setDeposits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [i, d] = await Promise.all([
        axios.get(`${API}/wallet/deposit-info`, authHeader),
        axios.get(`${API}/wallet/deposits`, authHeader),
      ]);
      setInfo(i.data);
      setDeposits(d.data);
    } catch {
      toast.error("Couldn't load top-up details");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { if (open) { setLoading(true); load(); } }, [open, load]);

  const submit = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");
    if (!ref.trim()) return toast.error("Enter your payment reference / UTR");
    setBusy(true);
    try {
      await axios.post(`${API}/wallet/deposit-request`, { amount_inr: amt, reference_note: ref.trim() }, authHeader);
      toast.success("Top-up request sent", { description: "Your agent will confirm it shortly." });
      setAmount(""); setRef("");
      await load();
      onSubmitted?.();
    } catch (e) {
      toast.error("Couldn't submit", { description: e.response?.data?.detail || "" });
    } finally { setBusy(false); }
  };

  const bank = info?.bank_account;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[110] flex items-end justify-center sm:items-center" data-testid="add-coins-modal">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-background p-6 shadow-lift sm:rounded-3xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-royal-light text-royal"><Coins className="h-5 w-5" /></span>
                <h2 className="font-display text-xl font-extrabold tracking-tight text-slate-900">Add Coins</h2>
              </div>
              <button data-testid="add-coins-close" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl bg-white text-slate-500 shadow-soft"><X className="h-4 w-4" /></button>
            </div>

            {loading ? (
              <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-royal" /></div>
            ) : (
              <>
                {/* Bank details */}
                {bank ? (
                  <div className="rounded-2xl bg-white p-5 shadow-soft" data-testid="deposit-bank">
                    <div className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-900">
                      <Landmark className="h-4 w-4 text-royal" /> Pay your agent {info.admin_name}
                    </div>
                    <p className="mb-3 text-xs text-slate-500">Transfer to this account, then submit the amount + your reference below.</p>
                    <Row label="Account holder" value={bank.account_holder_name} />
                    <Row label="Account number" value={bank.account_number} />
                    <Row label="IFSC" value={bank.ifsc} />
                    <Row label="Bank" value={bank.bank_name} />
                    <p className="mt-3 rounded-xl bg-royal-light px-3 py-2 text-[11px] font-semibold text-royal">
                      Rate: ₹1 = {info.ratio} coin{info.ratio === 1 ? "" : "s"}
                    </p>
                  </div>
                ) : (
                  <div data-testid="deposit-no-bank" className="rounded-2xl bg-white p-5 text-sm text-slate-500 shadow-soft">
                    {info?.admin_id
                      ? "Your collection agent hasn't added their bank details yet. Please check back soon."
                      : "No collection agent is assigned to your account yet. Please contact support."}
                  </div>
                )}

                {/* Request form */}
                {info?.admin_id && (
                  <div className="mt-4 rounded-2xl bg-white p-5 shadow-soft">
                    <p className="mb-3 text-sm font-bold text-slate-900">Submit a top-up request</p>
                    <div className="space-y-3">
                      <input
                        data-testid="deposit-amount" type="number" inputMode="numeric" placeholder="Amount in ₹"
                        value={amount} onChange={(e) => setAmount(e.target.value)}
                        className="w-full rounded-2xl border-2 border-slate-100 bg-white px-4 py-3 text-sm font-medium text-slate-900 outline-none focus:border-royal/40"
                      />
                      <input
                        data-testid="deposit-reference" placeholder="Payment reference / UTR number"
                        value={ref} onChange={(e) => setRef(e.target.value)}
                        className="w-full rounded-2xl border-2 border-slate-100 bg-white px-4 py-3 text-sm font-medium text-slate-900 outline-none focus:border-royal/40"
                      />
                      {amount > 0 && (
                        <p className="text-xs font-semibold text-slate-500">You'll receive <span className="text-royal">{fmt(Number(amount) * (info.ratio || 1))} coins</span> after confirmation.</p>
                      )}
                      <button
                        data-testid="deposit-submit" onClick={submit} disabled={busy}
                        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-royal px-5 py-3.5 text-sm font-bold text-white transition-transform hover:-translate-y-0.5 disabled:opacity-50"
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Submit Request
                      </button>
                    </div>
                  </div>
                )}

                {/* History */}
                <div className="mt-6">
                  <p className="mb-3 text-sm font-bold text-slate-900">Your top-up requests</p>
                  {deposits.length === 0 ? (
                    <p data-testid="deposit-empty" className="rounded-2xl bg-white p-5 text-center text-sm text-slate-400 shadow-soft">No requests yet.</p>
                  ) : (
                    <div className="space-y-2" data-testid="deposit-history">
                      {deposits.map((d) => {
                        const s = STATUS[d.status] || STATUS.PENDING;
                        const SIcon = s.icon;
                        return (
                          <div key={d.id} data-testid={`deposit-item-${d.id}`} className="rounded-2xl bg-white p-4 shadow-soft">
                            <div className="flex items-center justify-between">
                              <span className="font-display text-lg font-extrabold text-slate-900">₹{fmt(d.amount_inr)}</span>
                              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${s.cls}`}>
                                <SIcon className="h-3.5 w-3.5" /> {s.label}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-slate-500">Ref: {d.reference_note} · {fmt(d.coins_to_credit)} coins</p>
                            {d.confirm_note && <p className="mt-1 text-xs font-medium text-emerald-600">Agent: {d.confirm_note}</p>}
                            {d.rejected_reason && <p className="mt-1 text-xs font-medium text-red-500">Rejected: {d.rejected_reason}</p>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
