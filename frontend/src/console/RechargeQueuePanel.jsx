import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, X, Loader2, Zap, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { useConsoleApi, fmtCoins, fmtDate, shortId } from "./api";
import { CARD, PanelHeader, PrimaryButton, GhostButton, StatusBadge, Modal, Field, Spinner, EmptyState } from "./primitives";

// Super Admin queue for Admin self-recharge requests (confirm/reject).
export const RechargeQueuePanel = ({ query = "" }) => {
  const api = useConsoleApi();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState(null); // {type, r}
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/superadmin/recharges");
      setRows(data);
    } catch {
      toast.error("Couldn't load recharge requests");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (r.admin_name || "").toLowerCase().includes(q) || (r.reference_note || "").toLowerCase().includes(q) || r.id.includes(q));
  }, [rows, query]);

  const submit = async () => {
    if (busy) return;
    if (action.type === "reject" && !text.trim()) return toast.error("Enter a rejection reason");
    setBusy(true);
    try {
      const body = action.type === "confirm" ? { note: text || undefined } : { reason: text.trim() };
      await api.post(`/superadmin/recharges/${action.r.id}/${action.type}`, body);
      toast.success(action.type === "confirm" ? "Recharge confirmed — coins credited" : "Recharge rejected");
      setAction(null); setText("");
      await load();
    } catch (e) {
      toast.error("Action failed", { description: e.response?.data?.detail || "" });
    } finally { setBusy(false); }
  };

  const pending = filtered.filter((r) => r.status === "PENDING").length;

  return (
    <div data-testid="recharge-queue-panel">
      <PanelHeader title="Recharge Requests" subtitle={`${pending} pending · Admins topping up their own quota (paid to you)`} />

      {loading ? <Spinner label="Loading requests…" /> : filtered.length === 0 ? (
        <EmptyState testid="recharge-queue-empty" title="No recharge requests" subtitle="Admin self-recharge requests will appear here for review." />
      ) : (
        <div className="space-y-4" data-testid="recharge-queue-list">
          {filtered.map((r) => {
            const isPending = r.status === "PENDING";
            return (
              <div key={r.id} data-testid={`recharge-${r.id}`} className={`${CARD} p-5`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-slate-900">{r.admin_name}
                      <span className="ml-2 font-mono text-[11px] font-normal text-slate-400">{shortId(r.id)}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">{fmtDate(r.created_at)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-display text-xl font-bold text-sky-600">₹{fmtCoins(r.amount_inr)}</p>
                    <p className="text-[11px] text-slate-400">→ {fmtCoins(r.coins_credited)} coins @ {r.bonus_rate}x</p>
                  </div>
                </div>
                <div className="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5">
                  <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <p className="text-sm text-slate-700"><span className="text-slate-400">Reference:</span> {r.reference_note}</p>
                </div>
                {r.rejected_reason && <p className="mt-2 text-xs font-medium text-rose-600">Rejected: {r.rejected_reason}</p>}
                <div className="mt-4 flex items-center justify-between">
                  <StatusBadge status={r.status} />
                  {isPending && (
                    <div className="flex items-center gap-2">
                      <PrimaryButton data-testid={`recharge-confirm-${r.id}`} onClick={() => { setText(""); setAction({ type: "confirm", r }); }} className="!px-3 !py-2 text-xs !bg-emerald-600 hover:!bg-emerald-700"><Check className="h-3.5 w-3.5" /> Confirm</PrimaryButton>
                      <GhostButton data-testid={`recharge-reject-${r.id}`} onClick={() => { setText(""); setAction({ type: "reject", r }); }} className="!px-3 !py-2 text-xs"><X className="h-3.5 w-3.5" /> Reject</GhostButton>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={!!action} onClose={() => setAction(null)} title={action?.type === "confirm" ? "Confirm recharge" : "Reject recharge"} testid="recharge-action-modal">
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            {action?.type === "confirm"
              ? `Confirming credits ${fmtCoins(action?.r?.coins_credited)} coins to ${action?.r?.admin_name}. Only do this after you've received ₹${fmtCoins(action?.r?.amount_inr)}.`
              : "Rejecting will mark the request rejected with your reason. No coins are credited."}
          </p>
          <Field
            label={action?.type === "confirm" ? "Note (optional)" : "Reason"}
            data-testid="recharge-action-text" value={text} onChange={(e) => setText(e.target.value)}
          />
          <PrimaryButton data-testid="recharge-action-submit" onClick={submit} disabled={busy} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            {action?.type === "confirm" ? "Confirm & Credit" : "Reject Request"}
          </PrimaryButton>
        </div>
      </Modal>
    </div>
  );
};
