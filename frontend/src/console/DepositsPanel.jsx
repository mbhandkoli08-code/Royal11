import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, X, Loader2, Clock, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useConsoleApi, fmtCoins, fmtDate, shortId } from "./api";
import { CARD, PanelHeader, PrimaryButton, GhostButton, StatusBadge, Modal, Field, Spinner, EmptyState } from "./primitives";

// Chat-thread-style deposit review. Only an ADMIN (the target agent) can
// confirm/reject; Manager/Super Admin see it read-only for oversight.
export const DepositsPanel = ({ query = "" }) => {
  const api = useConsoleApi();
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const suspended = user?.status === "SUSPENDED";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState(null); // {type:"confirm"|"reject", dep}
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/deposits");
      setRows(data);
    } catch {
      toast.error("Couldn't load deposits");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((d) =>
      (d.player_name || "").toLowerCase().includes(q) ||
      (d.reference_note || "").toLowerCase().includes(q) ||
      d.id.includes(q) || (d.status || "").toLowerCase().includes(q));
  }, [rows, query]);

  const submit = async () => {
    if (busy) return;
    if (action.type === "reject" && !text.trim()) return toast.error("Enter a rejection reason");
    setBusy(true);
    try {
      const path = `/admin/deposits/${action.dep.id}/${action.type}`;
      const body = action.type === "confirm" ? { note: text || undefined } : { reason: text.trim() };
      await api.post(path, body);
      toast.success(action.type === "confirm" ? "Deposit confirmed — coins credited" : "Deposit rejected");
      setAction(null); setText("");
      await load();
    } catch (e) {
      toast.error("Action failed", { description: e.response?.data?.detail || "" });
    } finally { setBusy(false); }
  };

  const pending = filtered.filter((d) => d.status === "PENDING").length;

  return (
    <div data-testid="deposits-panel">
      <PanelHeader title="Deposits" subtitle={`${pending} pending · manual coin top-up requests from players`} />

      {loading ? <Spinner label="Loading deposits…" /> : filtered.length === 0 ? (
        <EmptyState testid="deposits-empty" title="No deposit requests" subtitle="Player top-up requests will appear here for review." />
      ) : (
        <div className="space-y-4" data-testid="deposits-list">
          {filtered.map((d) => {
            const isPending = d.status === "PENDING";
            return (
              <div key={d.id} data-testid={`deposit-${d.id}`} className={`${CARD} p-5`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-slate-900">{d.player_name || "Player"}
                      <span className="ml-2 font-mono text-[11px] font-normal text-slate-400">{shortId(d.id)}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">{fmtDate(d.created_at)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-display text-xl font-extrabold text-sky-600">₹{fmtCoins(d.amount_inr)}</p>
                    <p className="text-[11px] text-slate-400">{fmtCoins(d.coins_to_credit)} coins</p>
                  </div>
                </div>

                {/* Thread */}
                <div className="mt-4 space-y-2">
                  <div className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5">
                    <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    <p className="text-sm text-slate-700"><span className="text-slate-400">Reference:</span> {d.reference_note}</p>
                  </div>
                  {d.confirm_note && (
                    <div className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2.5">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      <p className="text-sm text-emerald-700">{d.confirm_note}</p>
                    </div>
                  )}
                  {d.rejected_reason && (
                    <div className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2.5">
                      <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                      <p className="text-sm text-rose-700">{d.rejected_reason}</p>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex items-center justify-between">
                  {isPending ? <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-600"><Clock className="h-3.5 w-3.5" /> Awaiting your confirmation</span> : <StatusBadge status={d.status} />}
                  {isAdmin && isPending && (
                    <div className="flex items-center gap-2">
                      <PrimaryButton data-testid={`deposit-confirm-${d.id}`} disabled={suspended} onClick={() => { setText(""); setAction({ type: "confirm", dep: d }); }} className="!px-3 !py-2 text-xs !bg-emerald-600"><Check className="h-3.5 w-3.5" /> Confirm</PrimaryButton>
                      <GhostButton data-testid={`deposit-reject-${d.id}`} disabled={suspended} onClick={() => { setText(""); setAction({ type: "reject", dep: d }); }} className="!px-3 !py-2 text-xs"><X className="h-3.5 w-3.5" /> Reject</GhostButton>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={!!action} onClose={() => setAction(null)} title={action?.type === "confirm" ? "Confirm deposit" : "Reject deposit"} testid="deposit-action-modal">
        <div className="space-y-4">
          <p className="text-xs text-slate-400">
            {action?.type === "confirm"
              ? `Confirming credits ${fmtCoins(action?.dep?.coins_to_credit)} coins to ${action?.dep?.player_name || "the player"}. Only do this after you've received ₹${fmtCoins(action?.dep?.amount_inr)}.`
              : "Rejecting will notify the player with your reason. No coins are credited."}
          </p>
          <Field
            label={action?.type === "confirm" ? "Note (optional)" : "Reason"}
            data-testid="deposit-action-text" value={text} onChange={(e) => setText(e.target.value)}
            placeholder={action?.type === "confirm" ? "e.g. Received, thanks!" : "e.g. Reference not found"}
          />
          <PrimaryButton data-testid="deposit-action-submit" onClick={submit} disabled={busy} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : action?.type === "confirm" ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
            {action?.type === "confirm" ? "Confirm & Credit" : "Reject Request"}
          </PrimaryButton>
        </div>
      </Modal>
    </div>
  );
};
