import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, X, Loader2, Clock, MessageSquare, AlertTriangle, ShieldCheck, ShieldAlert, ScanLine, ImageOff, ZoomIn } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useConsoleApi, fmtCoins, fmtDate, shortId } from "./api";
import { CARD, PanelHeader, PrimaryButton, GhostButton, StatusBadge, Modal, Field, Spinner, EmptyState } from "./primitives";

// Loads a deposit's payment screenshot through the backend (auth header can't
// be sent via <img src>), shows a thumbnail, and opens a full-size viewer.
const DepositScreenshot = ({ depositId }) => {
  const api = useConsoleApi();
  const [url, setUrl] = useState(null);
  const [state, setState] = useState("loading"); // loading | ok | error
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    let objectUrl;
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get(`/admin/deposits/${depositId}/screenshot`, { responseType: "blob" });
        objectUrl = URL.createObjectURL(data);
        if (alive) { setUrl(objectUrl); setState("ok"); }
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [api, depositId]);

  if (state === "loading") return <div data-testid={`screenshot-loading-${depositId}`} className="flex h-40 items-center justify-center rounded-xl bg-slate-50"><Loader2 className="h-5 w-5 animate-spin text-sky-500" /></div>;
  if (state === "error") return <div data-testid={`screenshot-error-${depositId}`} className="flex h-40 flex-col items-center justify-center gap-1.5 rounded-xl bg-slate-50 text-slate-400"><ImageOff className="h-5 w-5" /><span className="text-xs">Screenshot unavailable</span></div>;

  return (
    <>
      <button data-testid={`screenshot-thumb-${depositId}`} onClick={() => setZoom(true)} className="group relative block w-full overflow-hidden rounded-xl border border-slate-200">
        <img src={url} alt="Payment screenshot" className="max-h-52 w-full object-contain bg-slate-50" />
        <span className="absolute inset-0 flex items-center justify-center bg-slate-900/0 text-white opacity-0 transition-all group-hover:bg-slate-900/30 group-hover:opacity-100"><ZoomIn className="h-6 w-6" /></span>
      </button>
      <Modal open={zoom} onClose={() => setZoom(false)} title="Payment screenshot" testid={`screenshot-modal-${depositId}`}>
        <img src={url} alt="Payment screenshot" className="max-h-[70vh] w-full rounded-xl object-contain bg-slate-50" />
      </Modal>
    </>
  );
};

const FieldCheck = ({ label, ok, value }) => {
  const cls = ok === true ? "text-emerald-600" : ok === false ? "text-rose-600" : "text-slate-400";
  const Icon = ok === true ? Check : ok === false ? X : MessageSquare;
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className={`inline-flex items-center gap-1.5 font-semibold ${cls}`}><Icon className="h-3.5 w-3.5" /> {label}</span>
      <span className="truncate text-slate-500">{value ?? "—"}</span>
    </div>
  );
};

// Green "Matches" / red "Review carefully" / grey "OCR unavailable" — advisory only.
const OcrPanel = ({ ocr, enteredAmount, enteredRef }) => {
  if (!ocr) return null;
  const verdict = ocr.match?.overall;
  const cfg = verdict === "match"
    ? { cls: "bg-emerald-50 border-emerald-200 text-emerald-700", Icon: ShieldCheck, label: "Matches" }
    : verdict === "review"
      ? { cls: "bg-rose-50 border-rose-200 text-rose-700", Icon: ShieldAlert, label: "Review carefully" }
      : { cls: "bg-slate-50 border-slate-200 text-slate-500", Icon: ScanLine, label: "OCR unavailable — review manually" };
  const m = ocr.match || {};
  const ex = ocr.extracted || {};
  return (
    <div data-testid="ocr-panel" className={`mt-3 rounded-xl border p-3 ${cfg.cls}`}>
      <div className="flex items-center gap-1.5 text-xs font-bold" data-testid="ocr-verdict">
        <cfg.Icon className="h-4 w-4" /> {cfg.label}
      </div>
      {verdict !== "unknown" && (
        <div className="mt-2 space-y-1.5 rounded-lg bg-white/70 p-2.5">
          <FieldCheck label="Amount" ok={m.amount} value={ex.amount_inr != null ? `₹${fmtCoins(ex.amount_inr)} vs ₹${fmtCoins(enteredAmount)}` : `entered ₹${fmtCoins(enteredAmount)}`} />
          <FieldCheck label="UTR / Ref" ok={m.utr} value={ex.utr || enteredRef} />
          <FieldCheck label="Timestamp" ok={m.timestamp} value={ex.timestamp || "not detected"} />
        </div>
      )}
    </div>
  );
};

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
  const [creditWarn, setCreditWarn] = useState(null);

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
      const detail = e.response?.data?.detail;
      if (detail && typeof detail === "object" && detail.code === "CREDIT_LINE_EXCEEDED") {
        setAction(null); setText("");
        setCreditWarn(detail);
      } else {
        toast.error("Action failed", { description: typeof detail === "string" ? detail : "" });
      }
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

                {d.duplicate_utr && (
                  <div data-testid={`deposit-duplicate-${d.id}`} className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <p className="text-sm font-semibold text-amber-800">Possible duplicate — this reference/UTR matches a previously confirmed deposit. Verify before confirming.</p>
                  </div>
                )}

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

                {/* Screenshot + OCR verification (side-by-side on wide screens) */}
                {d.has_screenshot ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Payment proof</p>
                      <DepositScreenshot depositId={d.id} />
                    </div>
                    <div>
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Auto-verification</p>
                      <OcrPanel ocr={d.ocr} enteredAmount={d.amount_inr} enteredRef={d.reference_note} />
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-xs italic text-slate-400">No payment screenshot attached — review the reference manually.</p>
                )}

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

      {/* Unmissable credit-line warning when float + credit can't cover a recharge */}
      <Modal open={!!creditWarn} onClose={() => setCreditWarn(null)} title="Insufficient balance" testid="credit-warn-modal">
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
            <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-rose-600" />
            <div>
              <p className="text-sm font-bold text-rose-800">Your balance is insufficient to complete this recharge.</p>
              <p className="mt-1 text-xs text-rose-700">{creditWarn?.message}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl bg-slate-50 p-3"><p className="text-lg font-black text-slate-900">{fmtCoins(creditWarn?.shortfall)}</p><p className="text-[11px] text-slate-500">Shortfall</p></div>
            <div className="rounded-xl bg-slate-50 p-3"><p className="text-lg font-black text-slate-900">{fmtCoins(creditWarn?.remaining_credit)}</p><p className="text-[11px] text-slate-500">Credit left</p></div>
          </div>
          <p className="text-xs text-slate-400">Refill your float, or request more credit from your Manager under "My Credit Line", then try again.</p>
          <PrimaryButton data-testid="credit-warn-close" onClick={() => setCreditWarn(null)} className="w-full">Got it</PrimaryButton>
        </div>
      </Modal>
    </div>
  );
};
