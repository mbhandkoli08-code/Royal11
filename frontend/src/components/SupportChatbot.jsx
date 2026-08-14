import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, Loader2, LifeBuoy } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const JOKER = "https://static.prod-images.emergentagent.com/jobs/2089563f-7946-482c-bbad-1a5b016d32c2/images/b699cef89ea177b822f771f3208c4985a22ff6671411a0cc37050245aca9cf19.jpeg";
const QUICK = [
  "How do I add coins?",
  "Are the games provably fair?",
  "How do fantasy contests work?",
  "My deposit hasn't been credited",
];
const CATEGORIES = ["GENERAL", "DEPOSIT", "GAME", "ACCOUNT"];

export const SupportChatbot = () => {
  const { token, user } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState(() => localStorage.getItem("royal11_chat_session") || "");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [showEscalate, setShowEscalate] = useState(false);
  const [escForm, setEscForm] = useState({ category: "GENERAL", subject: "" });
  const scrollRef = useRef(null);

  const isPlayer = user?.role === "PLAYER";

  const scrollToEnd = () => setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }), 60);

  const loadSession = useCallback(async () => {
    if (!sessionId) return;
    try {
      const { data } = await axios.get(`${API}/chatbot/session/${sessionId}`, { headers });
      setMessages(data.messages || []);
      scrollToEnd();
    } catch { /* ignore */ }
  }, [sessionId]);

  useEffect(() => { if (open) loadSession(); }, [open, loadSession]);

  const send = async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: msg }]);
    setBusy(true);
    scrollToEnd();
    try {
      const { data } = await axios.post(`${API}/chatbot/message`, { session_id: sessionId, message: msg }, { headers });
      if (!sessionId) { setSessionId(data.session_id); localStorage.setItem("royal11_chat_session", data.session_id); }
      setMessages((m) => [...m, { role: "assistant", text: data.reply }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "I couldn't reach support right now. Please try again or raise a ticket." }]);
    } finally { setBusy(false); scrollToEnd(); }
  };

  const submitEscalate = async () => {
    if (escForm.subject.trim().length < 3) return toast.error("Add a short subject (min 3 chars)");
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/chatbot/escalate`, {
        session_id: sessionId || "seed", category: escForm.category, subject: escForm.subject.trim(),
        description: "Escalated from Q JOKER chat",
      }, { headers });
      toast.success(`Ticket ${data.ticket_no} created`, { description: "A human agent will reply — track it in Wallet › Support." });
      setShowEscalate(false); setEscForm({ category: "GENERAL", subject: "" });
      setMessages((m) => [...m, { role: "assistant", text: `I've raised ticket ${data.ticket_no} for you. A human agent will take it from here — you can track it in Wallet › Support.` }]);
      scrollToEnd();
    } catch (e) {
      toast.error("Couldn't raise ticket", { description: e.response?.data?.detail || "" });
    } finally { setBusy(false); }
  };

  if (!isPlayer) return null;

  return (
    <>
      {/* Floating launcher */}
      <button
        data-testid="chatbot-launcher"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-24 right-4 z-[95] grid h-16 w-16 place-items-center rounded-full shadow-2xl ring-2 ring-amber-300/60 md:bottom-6"
        style={{ background: "radial-gradient(circle at 40% 30%, #3a0d10, #1a0507)" }}
        aria-label="Open support chat"
      >
        <img src={JOKER} alt="Q JOKER" className="h-14 w-14 rounded-full object-cover" />
        <span className="absolute -right-0.5 -top-0.5 grid h-5 w-5 place-items-center rounded-full bg-amber-400 text-[9px] font-black text-[#2a1503]">?</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            data-testid="chatbot-panel"
            initial={{ opacity: 0, y: 30, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 30, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            className="fixed bottom-24 right-4 z-[96] flex h-[540px] max-h-[80vh] w-[92vw] max-w-sm flex-col overflow-hidden rounded-3xl border border-amber-300/30 bg-[#170507] shadow-2xl md:bottom-6"
          >
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-amber-300/20 bg-gradient-to-r from-[#3a0d10] to-[#1a0507] p-3">
              <img src={JOKER} alt="Q JOKER" className="h-10 w-10 rounded-full object-cover ring-2 ring-amber-300/50" />
              <div className="flex-1">
                <p className="font-display text-sm font-extrabold text-amber-200">Q JOKER</p>
                <p className="text-[11px] text-amber-100/60">Your ROYAL11 helper · read-only</p>
              </div>
              <button data-testid="chatbot-close" onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-full bg-black/30 text-amber-200/80 hover:bg-black/50"><X className="h-4 w-4" /></button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3" data-testid="chatbot-messages">
              {messages.length === 0 && (
                <div className="rounded-2xl bg-black/25 p-3 text-sm text-amber-100/80 ring-1 ring-amber-300/15">
                  Hi {user?.display_name?.split(" ")[0] || "there"}! 🃏 I&apos;m Q JOKER. Ask me anything about coins, games, fantasy or your account.
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div data-testid={`chatbot-msg-${m.role}`} className={`max-w-[82%] rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "bg-gradient-to-r from-amber-300 to-yellow-600 text-[#2a1503]" : "bg-black/30 text-amber-50 ring-1 ring-amber-300/15"}`}>
                    {m.text}
                  </div>
                </div>
              ))}
              {busy && <div className="flex justify-start"><div className="rounded-2xl bg-black/30 px-3 py-2 text-amber-100/60 ring-1 ring-amber-300/15"><Loader2 className="h-4 w-4 animate-spin" /></div></div>}
            </div>

            {/* Quick replies */}
            {messages.length === 0 && (
              <div className="flex flex-wrap gap-1.5 px-3 pb-2">
                {QUICK.map((q) => (
                  <button key={q} data-testid="chatbot-quick" onClick={() => send(q)} disabled={busy}
                    className="rounded-full bg-black/30 px-2.5 py-1 text-[11px] font-semibold text-amber-100/80 ring-1 ring-amber-300/20 hover:bg-black/50">{q}</button>
                ))}
              </div>
            )}

            {/* Escalate form */}
            {showEscalate ? (
              <div className="border-t border-amber-300/20 bg-black/30 p-3" data-testid="chatbot-escalate-form">
                <p className="mb-2 text-xs font-bold text-amber-200">Raise a support ticket to a human agent</p>
                <div className="flex gap-2">
                  <select data-testid="escalate-category" value={escForm.category} onChange={(e) => setEscForm((f) => ({ ...f, category: e.target.value }))}
                    className="rounded-xl bg-black/40 px-2 py-2 text-xs text-amber-100 ring-1 ring-amber-300/20">
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input data-testid="escalate-subject" value={escForm.subject} onChange={(e) => setEscForm((f) => ({ ...f, subject: e.target.value }))}
                    placeholder="Short subject" className="flex-1 rounded-xl bg-black/40 px-3 py-2 text-xs text-amber-100 outline-none ring-1 ring-amber-300/20" />
                </div>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => setShowEscalate(false)} className="flex-1 rounded-xl bg-white/10 py-2 text-xs font-bold text-amber-100/80">Cancel</button>
                  <button data-testid="escalate-submit" onClick={submitEscalate} disabled={busy} className="flex-1 rounded-xl bg-gradient-to-r from-amber-300 to-yellow-600 py-2 text-xs font-black text-[#2a1503]">Create ticket</button>
                </div>
              </div>
            ) : (
              <>
                <div className="px-3 pb-1">
                  <button data-testid="chatbot-escalate-open" onClick={() => setShowEscalate(true)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-amber-300/25 bg-black/20 py-2 text-[11px] font-bold text-amber-200/90 hover:bg-black/40">
                    <LifeBuoy className="h-3.5 w-3.5" /> Talk to a human · Raise a ticket
                  </button>
                </div>
                {/* Input */}
                <div className="flex items-center gap-2 border-t border-amber-300/20 p-3">
                  <input
                    data-testid="chatbot-input" value={input} onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") send(); }}
                    placeholder="Ask Q JOKER…" disabled={busy}
                    className="flex-1 rounded-full bg-black/30 px-4 py-2.5 text-sm text-amber-50 outline-none ring-1 ring-amber-300/20 placeholder:text-amber-100/40"
                  />
                  <button data-testid="chatbot-send" onClick={() => send()} disabled={busy || !input.trim()}
                    className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-r from-amber-300 to-yellow-600 text-[#2a1503] disabled:opacity-50">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
