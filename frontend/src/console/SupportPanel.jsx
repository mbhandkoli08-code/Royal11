import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { LifeBuoy, Send, ArrowUpCircle, Lock, RefreshCw } from "lucide-react";
import { useConsoleApi, fmtDate } from "@/console/api";
import { useAuth } from "@/context/AuthContext";
import { CARD, PanelHeader, Spinner, EmptyState, StatCard, PrimaryButton, GhostButton } from "@/console/primitives";

const STATUS_STYLES = {
  OPEN: "bg-amber-100 text-amber-700",
  IN_PROGRESS: "bg-sky-100 text-sky-700",
  RESOLVED: "bg-emerald-100 text-emerald-700",
  CLOSED: "bg-slate-100 text-slate-600",
};
const PRIORITY_STYLES = { HIGH: "bg-rose-100 text-rose-700", NORMAL: "bg-slate-100 text-slate-600", LOW: "bg-slate-100 text-slate-500" };
const STATUS_OPTIONS = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];
const CATEGORIES = ["", "DEPOSIT", "WITHDRAWAL", "GAME", "ACCOUNT", "GENERAL"];

const Chip = ({ text, cls }) => (
  <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold ${cls}`}>{text?.replace("_", " ")}</span>
);

export const SupportPanel = () => {
  const api = useConsoleApi();
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [counts, setCounts] = useState({ open: 0, in_progress: 0, resolved: 0, total: 0 });
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [selId, setSelId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = statusFilter ? `?status=${statusFilter}` : "";
      const { data } = await api.get(`/support/admin/tickets${q}`);
      setTickets(data.tickets);
      setCounts(data.counts);
    } catch { toast.error("Couldn't load tickets"); }
    setLoading(false);
  }, [api, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const openTicket = async (id) => {
    setSelId(id); setDetail(null);
    try { const { data } = await api.get(`/support/tickets/${id}`); setDetail(data); }
    catch { toast.error("Couldn't open ticket"); }
  };

  const act = async (fn, ok) => {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); await openTicket(selId); await load(); }
    catch (e) { toast.error(e.response?.data?.detail || "Action failed"); }
    setBusy(false);
  };

  const sendReply = () => {
    if (!reply.trim()) return;
    const body = reply; const isInternal = internal;
    setReply(""); setInternal(false);
    act(() => api.post(`/support/admin/tickets/${selId}/reply`, { body, internal: isInternal }));
  };
  const setStatus = (status) => act(() => api.put(`/support/admin/tickets/${selId}/status`, { status }), `Marked ${status.replace("_", " ")}`);
  const escalate = () => act(() => api.post(`/support/admin/tickets/${selId}/escalate`, {}), "Escalated to upline");

  return (
    <div data-testid="support-panel">
      <PanelHeader
        title="Support"
        subtitle="Player complaints & queries routed to your team"
        actions={<GhostButton data-testid="support-refresh" onClick={load}><RefreshCw className="h-4 w-4" /> Refresh</GhostButton>}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard icon={LifeBuoy} label="Open" value={counts.open} accent="cherry" testid="support-stat-open" />
        <StatCard icon={LifeBuoy} label="In progress" value={counts.in_progress} testid="support-stat-inprogress" />
        <StatCard icon={LifeBuoy} label="Resolved" value={counts.resolved} testid="support-stat-resolved" />
        <StatCard icon={LifeBuoy} label="Total" value={counts.total} testid="support-stat-total" />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {["", ...STATUS_OPTIONS].map((s) => (
          <button key={s || "ALL"} data-testid={`support-filter-${s || "all"}`} onClick={() => setStatusFilter(s)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors ${statusFilter === s ? "bg-sky-500 text-white" : "bg-white text-slate-500 border border-slate-200 hover:bg-slate-50"}`}>
            {s ? s.replace("_", " ") : "All"}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        {/* List */}
        <div className={`${CARD} max-h-[70vh] overflow-y-auto p-2`}>
          {loading ? <Spinner /> : tickets.length === 0 ? (
            <EmptyState title="No tickets" subtitle="Player complaints will appear here" testid="support-empty" />
          ) : tickets.map((t) => (
            <button key={t.id} data-testid={`support-ticket-${t.id}`} onClick={() => openTicket(t.id)}
              className={`mb-1 w-full rounded-xl border p-3 text-left transition-colors ${selId === t.id ? "border-sky-300 bg-sky-50" : "border-transparent hover:bg-slate-50"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-bold text-slate-900">{t.subject}</span>
                <Chip text={t.priority} cls={PRIORITY_STYLES[t.priority]} />
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-500">{t.player_name} · {t.ticket_no}</p>
              <div className="mt-2 flex items-center gap-2">
                <Chip text={t.status} cls={STATUS_STYLES[t.status]} />
                <Chip text={t.category} cls="bg-slate-100 text-slate-500" />
                {t.escalation_level > 0 && <Chip text={`ESC ${t.escalation_level}`} cls="bg-orange-100 text-orange-700" />}
              </div>
            </button>
          ))}
        </div>

        {/* Detail */}
        <div className={`${CARD} flex max-h-[70vh] flex-col p-4`} data-testid="support-detail">
          {!detail ? (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-400">Select a ticket to view the conversation</div>
          ) : (
            <>
              <div className="border-b border-slate-100 pb-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-lg font-bold text-slate-900">{detail.subject}</h3>
                  <Chip text={detail.status} cls={STATUS_STYLES[detail.status]} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {detail.ticket_no} · {detail.player_name} · {detail.category}
                  {detail.escalated_to_name ? ` · escalated to ${detail.escalated_to_name}` : ""}
                </p>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto py-4" data-testid="support-thread">
                {detail.messages.map((m) => {
                  const mine = m.author_id === user?.id;
                  const staff = m.author_role !== "PLAYER";
                  return (
                    <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm ${m.internal ? "border border-amber-300 bg-amber-50 text-amber-900" : mine ? "bg-sky-500 text-white" : staff ? "bg-slate-100 text-slate-800" : "bg-slate-800 text-white"}`}>
                        <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-bold opacity-80">
                          {m.internal && <Lock className="h-3 w-3" />}
                          {m.author_name || "User"} · {staff ? m.author_role.replace("_", " ") : "Player"}
                        </div>
                        <p className="whitespace-pre-wrap">{m.body}</p>
                        <p className="mt-1 text-[10px] opacity-60">{fmtDate(m.created_at)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Actions */}
              <div className="border-t border-slate-100 pt-3">
                <div className="mb-2 flex flex-wrap gap-2">
                  {STATUS_OPTIONS.filter((s) => s !== detail.status).map((s) => (
                    <button key={s} data-testid={`support-status-${s}`} disabled={busy} onClick={() => setStatus(s)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                      Mark {s.replace("_", " ")}
                    </button>
                  ))}
                  <button data-testid="support-escalate" disabled={busy} onClick={escalate}
                    className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-bold text-orange-700 hover:bg-orange-100 disabled:opacity-50">
                    <ArrowUpCircle className="h-3.5 w-3.5" /> Escalate
                  </button>
                </div>
                <div className="flex items-end gap-2">
                  <textarea data-testid="support-reply-input" value={reply} onChange={(e) => setReply(e.target.value)}
                    rows={2} placeholder="Type a reply…"
                    className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
                  <PrimaryButton data-testid="support-send" disabled={busy || !reply.trim()} onClick={sendReply}><Send className="h-4 w-4" /></PrimaryButton>
                </div>
                <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-500">
                  <input type="checkbox" data-testid="support-internal-toggle" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="rounded border-slate-300" />
                  <Lock className="h-3 w-3" /> Internal note (hidden from player)
                </label>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
