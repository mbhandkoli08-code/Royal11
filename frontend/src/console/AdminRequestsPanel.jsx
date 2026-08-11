import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, X, Loader2, Clock, UserPlus, Shield } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useConsoleApi, fmtDate, shortId } from "./api";
import { CARD, PanelHeader, PrimaryButton, GhostButton, StatusBadge, Modal, Field, Spinner, EmptyState } from "./primitives";

// Admin-creation approval queue. SUPER_ADMIN / ZONAL_MANAGER can approve+reject;
// a MANAGER sees their own submitted requests read-only.
export const AdminRequestsPanel = ({ query = "" }) => {
  const api = useConsoleApi();
  const { user } = useAuth();
  const canDecide = user?.role === "SUPER_ADMIN" || user?.role === "ZONAL_MANAGER";
  const suspended = user?.status === "SUSPENDED";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reject, setReject] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/admin-requests");
      setRows(data);
    } catch { toast.error("Couldn't load admin requests"); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (r.email || "").toLowerCase().includes(q) || (r.display_name || "").toLowerCase().includes(q) || (r.manager_name || "").toLowerCase().includes(q) || (r.status || "").toLowerCase().includes(q));
  }, [rows, query]);

  const approve = async (r) => {
    if (busy) return; setBusy(true);
    try {
      await api.post(`/admin/admin-requests/${r.id}/approve`);
      toast.success("Approved — Admin account created"); await load();
    } catch (e) { toast.error("Couldn't approve", { description: e.response?.data?.detail || "" }); }
    finally { setBusy(false); }
  };
  const submitReject = async () => {
    if (busy) return;
    if (!reason.trim()) return toast.error("Enter a reason");
    setBusy(true);
    try {
      await api.post(`/admin/admin-requests/${reject.id}/reject`, { reason: reason.trim() });
      toast.success("Request rejected"); setReject(null); setReason(""); await load();
    } catch (e) { toast.error("Couldn't reject", { description: e.response?.data?.detail || "" }); }
    finally { setBusy(false); }
  };

  const pending = filtered.filter((r) => r.status === "PENDING").length;

  return (
    <div data-testid="admin-requests-panel">
      <PanelHeader title="Admin Requests" subtitle={`${pending} pending · new Admin accounts awaiting approval`} />

      {loading ? <Spinner label="Loading requests…" /> : filtered.length === 0 ? (
        <EmptyState testid="admin-requests-empty" title="No admin requests" subtitle={canDecide ? "Requests from Managers in your scope appear here." : "Submit an Admin request from “My Admins”; it'll show here until approved."} />
      ) : (
        <div className="space-y-4" data-testid="admin-requests-list">
          {filtered.map((r) => {
            const isPending = r.status === "PENDING";
            return (
              <div key={r.id} data-testid={`admin-request-${r.id}`} className={`${CARD} p-5`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-2 font-bold text-slate-900">
                      <span className="grid h-8 w-8 place-items-center rounded-lg bg-sky-50 text-sky-600"><UserPlus className="h-4 w-4" /></span>
                      {r.display_name}
                      <span className="font-mono text-[11px] font-normal text-slate-400">{shortId(r.id)}</span>
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{r.email} · capacity {r.player_capacity}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      Requested by <b>{r.manager_name || "—"}</b>
                      {r.zonal_manager_name ? <> · zone <b>{r.zonal_manager_name}</b></> : <> · <span className="text-slate-500">no zone → Super Admin approves</span></>}
                      {" · "}{fmtDate(r.created_at)}
                    </p>
                  </div>
                  <StatusBadge status={r.status} />
                </div>

                {r.reject_reason && (
                  <div className="mt-3 flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2.5">
                    <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                    <p className="text-sm text-rose-700">{r.reject_reason}</p>
                  </div>
                )}

                {isPending && (
                  <div className="mt-4 flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-600"><Clock className="h-3.5 w-3.5" /> Pending approval</span>
                    {canDecide && (
                      <div className="flex items-center gap-2">
                        <PrimaryButton data-testid={`approve-request-${r.id}`} disabled={suspended || busy} onClick={() => approve(r)} className="!px-3 !py-2 text-xs !bg-emerald-600"><Check className="h-3.5 w-3.5" /> Approve</PrimaryButton>
                        <GhostButton data-testid={`reject-request-${r.id}`} disabled={suspended || busy} onClick={() => { setReason(""); setReject(r); }} className="!px-3 !py-2 text-xs"><X className="h-3.5 w-3.5" /> Reject</GhostButton>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal open={!!reject} onClose={() => setReject(null)} title="Reject admin request" testid="reject-request-modal">
        <div className="space-y-4">
          <p className="text-xs text-slate-400">The Manager will see your reason. No Admin account is created.</p>
          <Field label="Reason" data-testid="reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Duplicate / not needed right now" />
          <PrimaryButton data-testid="reject-submit" onClick={submitReject} disabled={busy} className="w-full"><Shield className="h-4 w-4" /> Reject Request</PrimaryButton>
        </div>
      </Modal>
    </div>
  );
};
