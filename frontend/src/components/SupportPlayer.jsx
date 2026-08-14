import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X, Plus, ChevronLeft, Send, LifeBuoy, Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const CATEGORIES = [
  { id: "DEPOSIT", label: "Deposit not credited" },
  { id: "WITHDRAWAL", label: "Withdrawal issue" },
  { id: "GAME", label: "Game issue" },
  { id: "ACCOUNT", label: "Account help" },
  { id: "GENERAL", label: "General query" },
];
const STATUS_STYLES = {
  OPEN: "bg-amber-100 text-amber-700",
  IN_PROGRESS: "bg-sky-100 text-sky-700",
  RESOLVED: "bg-emerald-100 text-emerald-700",
  CLOSED: "bg-slate-100 text-slate-600",
};

// Player-facing Help & Support drawer: raise a ticket, track status, chat with
// the support team. Opens from the Wallet page.
export const SupportPlayer = ({ open, onClose }) => {
  const { token, user } = useAuth();
  const headers = { headers: { Authorization: `Bearer ${token}` } };
  const [view, setView] = useState("list"); // list | new | detail
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ category: "GENERAL", subject: "", description: "" });

  const loadList = useCallback(async () => {
    setLoading(true);
    try { const { data } = await axios.get(`${API}/support/tickets`, headers); setTickets(data); }
    catch { toast.error("Couldn't load your tickets"); }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { if (open) { setView("list"); loadList(); } }, [open, loadList]);

  const openDetail = async (id) => {
    setView("detail"); setDetail(null);
    try { const { data } = await axios.get(`${API}/support/tickets/${id}`, headers); setDetail(data); }
    catch { toast.error("Couldn't open ticket"); }
  };

  const submitNew = async () => {
    if (form.subject.trim().length < 3 || form.description.trim().length < 3) {
      return toast.error("Add a subject and a short description");
    }
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/support/tickets`, form, headers);
      toast.success(`Ticket ${data.ticket_no} raised`);
      setForm({ category: "GENERAL", subject: "", description: "" });
      await loadList();
      openDetail(data.id);
    } catch (e) { toast.error(e.response?.data?.detail || "Couldn't raise ticket"); }
    setBusy(false);
  };

  const sendReply = async () => {
    if (!reply.trim()) return;
    const body = reply; setReply(""); setBusy(true);
    try { const { data } = await axios.post(`${API}/support/tickets/${detail.id}/messages`, { body }, headers); setDetail(data); }
    catch (e) { toast.error(e.response?.data?.detail || "Couldn't send"); }
    setBusy(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center" data-testid="support-player">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:h-[80vh] sm:rounded-3xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            {view !== "list" && (
              <button data-testid="support-back" onClick={() => setView("list")} className="grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:bg-slate-100">
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-royal-light text-royal"><LifeBuoy className="h-5 w-5" /></span>
            <h2 className="font-display text-lg font-bold text-slate-900">
              {view === "new" ? "New ticket" : view === "detail" ? detail?.ticket_no || "Ticket" : "Help & Support"}
            </h2>
          </div>
          <button data-testid="support-player-close" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {view === "list" && (
            <>
              <button data-testid="support-new-btn" onClick={() => setView("new")}
                className="mb-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-royal py-3 text-sm font-bold text-white transition-transform hover:-translate-y-0.5">
                <Plus className="h-4 w-4" /> Raise a new ticket
              </button>
              {loading ? (
                <div className="flex justify-center py-10 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : tickets.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-400">No tickets yet. Raise one and we'll help you out.</p>
              ) : tickets.map((t) => (
                <button key={t.id} data-testid={`support-ticket-row-${t.id}`} onClick={() => openDetail(t.id)}
                  className="mb-2 w-full rounded-2xl border border-slate-100 p-3.5 text-left transition-colors hover:bg-slate-50">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-bold text-slate-900">{t.subject}</span>
                    <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLES[t.status]}`}>{t.status.replace("_", " ")}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">{t.ticket_no} · {t.category}</p>
                </button>
              ))}
            </>
          )}

          {view === "new" && (
            <div className="space-y-4">
              <div>
                <span className="mb-1.5 block text-xs font-semibold text-slate-600">What's it about?</span>
                <div className="grid grid-cols-1 gap-2">
                  {CATEGORIES.map((c) => (
                    <button key={c.id} data-testid={`support-cat-${c.id}`} onClick={() => setForm({ ...form, category: c.id })}
                      className={`rounded-xl border px-3.5 py-2.5 text-left text-sm font-semibold transition-colors ${form.category === c.id ? "border-royal bg-royal-light text-royal" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-slate-600">Subject</span>
                <input data-testid="support-subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  placeholder="Short summary" className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-royal" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-slate-600">Describe the issue</span>
                <textarea data-testid="support-description" rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Tell us what happened, include any UTR / reference numbers" className="w-full resize-none rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-royal" />
              </label>
              <button data-testid="support-submit" disabled={busy} onClick={submitNew}
                className="w-full rounded-2xl bg-royal py-3 text-sm font-bold text-white disabled:opacity-50">
                {busy ? "Submitting…" : "Submit ticket"}
              </button>
            </div>
          )}

          {view === "detail" && (
            !detail ? (
              <div className="flex justify-center py-10 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-2xl bg-slate-50 p-3">
                  <p className="text-sm font-bold text-slate-900">{detail.subject}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{detail.category} · <span className="font-semibold">{detail.status.replace("_", " ")}</span></p>
                </div>
                {detail.messages.map((m) => {
                  const mine = m.author_id === user?.id;
                  return (
                    <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm ${mine ? "bg-royal text-white" : "bg-slate-100 text-slate-800"}`}>
                        {!mine && <p className="mb-0.5 text-[10px] font-bold opacity-70">Support</p>}
                        <p className="whitespace-pre-wrap">{m.body}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>

        {/* Reply bar (detail only, unless closed) */}
        {view === "detail" && detail && detail.status !== "CLOSED" && (
          <div className="flex items-end gap-2 border-t border-slate-100 p-3">
            <textarea data-testid="support-player-reply" rows={1} value={reply} onChange={(e) => setReply(e.target.value)}
              placeholder="Reply…" className="flex-1 resize-none rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-royal" />
            <button data-testid="support-player-send" disabled={busy || !reply.trim()} onClick={sendReply}
              className="grid h-11 w-11 place-items-center rounded-xl bg-royal text-white disabled:opacity-50"><Send className="h-4 w-4" /></button>
          </div>
        )}
      </div>
    </div>
  );
};
