import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, Loader2, LifeBuoy, Mic, Volume2, VolumeX } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { ROYAL_JOKER_AVATAR } from "@/lib/casinoAssets";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
// Unified approved Royal Mascot Joker (same character as the in-game Joker card).
const JOKER = ROYAL_JOKER_AVATAR;

// Q JOKER supports 6 languages (chatbot-only; rest of app stays English).
const LANGS = [
  { code: "en", short: "EN", label: "English", bcp47: "en-US" },
  { code: "hi", short: "हिं", label: "हिन्दी", bcp47: "hi-IN" },
  { code: "ta", short: "தமிழ்", label: "தமிழ்", bcp47: "ta-IN" },
  { code: "te", short: "తెలుగు", label: "తెలుగు", bcp47: "te-IN" },
  { code: "bn", short: "বাংলা", label: "বাংলা", bcp47: "bn-IN" },
  { code: "mr", short: "मराठी", label: "मराठी", bcp47: "mr-IN" },
];
const QUICK_BY_LANG = {
  en: ["How do I add coins?", "Are the games provably fair?", "How do fantasy contests work?", "My deposit hasn't been credited"],
  hi: ["मैं कॉइन कैसे जोड़ूँ?", "क्या गेम प्रोवेबली फेयर हैं?", "फैंटेसी कॉन्टेस्ट कैसे काम करते हैं?", "मेरा डिपॉज़िट क्रेडिट नहीं हुआ"],
  ta: ["நான் காயின்களை எப்படி சேர்ப்பது?", "விளையாட்டுகள் நியாயமானவையா?", "ஃபேண்டஸி போட்டிகள் எப்படி வேலை செய்கின்றன?", "என் டெபாசிட் வரவு வைக்கப்படவில்லை"],
  te: ["నేను కాయిన్లు ఎలా జోడించాలి?", "గేమ్‌లు న్యాయమైనవా?", "ఫాంటసీ పోటీలు ఎలా పనిచేస్తాయి?", "నా డిపాజిట్ క్రెడిట్ కాలేదు"],
  bn: ["আমি কীভাবে কয়েন যোগ করব?", "গেমগুলি কি সুষ্ঠু?", "ফ্যান্টাসি কনটেস্ট কীভাবে কাজ করে?", "আমার ডিপোজিট জমা হয়নি"],
  mr: ["मी कॉइन कसे जोडू?", "गेम्स प्रोव्हेबली फेअर आहेत का?", "फँटसी स्पर्धा कशा चालतात?", "माझी ठेव जमा झाली नाही"],
};
const CATEGORIES = ["GENERAL", "DEPOSIT", "GAME", "ACCOUNT"];

const detectLang = () => {
  const saved = localStorage.getItem("royal11_chat_lang");
  if (saved && LANGS.some((l) => l.code === saved)) return saved;
  const loc = (navigator.language || "en").slice(0, 2);
  return LANGS.some((l) => l.code === loc) ? loc : "en";
};

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
  const [language, setLanguage] = useState(detectLang);
  const [langOpen, setLangOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakOn, setSpeakOn] = useState(() => localStorage.getItem("royal11_chat_tts") === "1");
  const recogRef = useRef(null);
  const scrollRef = useRef(null);

  const isPlayer = user?.role === "PLAYER";
  const langObj = LANGS.find((l) => l.code === language) || LANGS[0];
  const QUICK = QUICK_BY_LANG[language] || QUICK_BY_LANG.en;

  const chooseLang = (code) => {
    setLanguage(code); setLangOpen(false);
    localStorage.setItem("royal11_chat_lang", code);
  };

  // Voice output (TTS) via the browser's SpeechSynthesis, in the chosen language.
  const speak = useCallback((text) => {
    if (!speakOn || !window.speechSynthesis || !text) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = langObj.bcp47;
      const v = window.speechSynthesis.getVoices().find((vo) => vo.lang === langObj.bcp47)
        || window.speechSynthesis.getVoices().find((vo) => vo.lang?.startsWith(language));
      if (v) u.voice = v;
      window.speechSynthesis.speak(u);
    } catch { /* TTS best-effort */ }
  }, [speakOn, langObj, language]);

  const toggleSpeak = () => {
    setSpeakOn((s) => {
      const next = !s;
      localStorage.setItem("royal11_chat_tts", next ? "1" : "0");
      if (!next && window.speechSynthesis) window.speechSynthesis.cancel();
      return next;
    });
  };

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
      const { data } = await axios.post(`${API}/chatbot/message`, { session_id: sessionId, message: msg, language }, { headers });
      if (!sessionId) { setSessionId(data.session_id); localStorage.setItem("royal11_chat_session", data.session_id); }
      setMessages((m) => [...m, { role: "assistant", text: data.reply }]);
      speak(data.reply);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "I couldn't reach support right now. Please try again or raise a ticket." }]);
    } finally { setBusy(false); scrollToEnd(); }
  };

  // Voice input (STT) via the browser's SpeechRecognition, in the chosen language.
  const startVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast.error("Voice input isn't supported in this browser"); return; }
    if (listening) { recogRef.current?.stop(); return; }
    const r = new SR();
    recogRef.current = r;
    r.lang = langObj.bcp47;
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onstart = () => setListening(true);
    r.onerror = (e) => { setListening(false); if (e.error !== "aborted") toast.error("Couldn't hear that — try again"); };
    r.onend = () => setListening(false);
    r.onresult = (e) => {
      const t = e.results?.[0]?.[0]?.transcript;
      if (t) send(t);
    };
    try { r.start(); } catch { setListening(false); }
  };

  const submitEscalate = async () => {
    if (escForm.subject.trim().length < 3) return toast.error("Add a short subject (min 3 chars)");
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/chatbot/escalate`, {
        session_id: sessionId || "seed", category: escForm.category, subject: escForm.subject.trim(),
        description: "Escalated from Zoya chat",
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
        <img src={JOKER} alt="Zoya" className="h-14 w-14 rounded-full object-cover" />
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
            <div className="flex items-center gap-2 border-b border-amber-300/20 bg-gradient-to-r from-[#3a0d10] to-[#1a0507] p-3">
              <img src={JOKER} alt="Zoya" className="h-10 w-10 rounded-full object-cover ring-2 ring-amber-300/50" />
              <div className="flex-1">
                <p className="font-display text-sm font-extrabold text-amber-200">Zoya</p>
                <p className="text-[11px] text-amber-100/60">Your ROYAL11 helper · read-only</p>
              </div>
              {/* Language picker */}
              <div className="relative">
                <button data-testid="chatbot-lang-btn" onClick={() => setLangOpen((v) => !v)}
                  className="rounded-full bg-black/30 px-2.5 py-1.5 text-[11px] font-bold text-amber-100 ring-1 ring-amber-300/30 hover:bg-black/50">{langObj.short} ▾</button>
                {langOpen && (
                  <div data-testid="chatbot-lang-menu" className="absolute right-0 z-10 mt-1 w-32 overflow-hidden rounded-xl border border-amber-300/30 bg-[#1a0507] shadow-2xl">
                    {LANGS.map((l) => (
                      <button key={l.code} data-testid={`chatbot-lang-${l.code}`} onClick={() => chooseLang(l.code)}
                        className={`block w-full px-3 py-2 text-left text-xs font-semibold hover:bg-black/40 ${l.code === language ? "text-amber-300" : "text-amber-100/80"}`}>{l.label}</button>
                    ))}
                  </div>
                )}
              </div>
              <button data-testid="chatbot-tts-toggle" onClick={toggleSpeak} title={speakOn ? "Voice replies on" : "Voice replies off"}
                className={`grid h-8 w-8 place-items-center rounded-full ring-1 ring-amber-300/30 ${speakOn ? "bg-amber-400 text-[#2a1503]" : "bg-black/30 text-amber-200/80 hover:bg-black/50"}`}>
                {speakOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </button>
              <button data-testid="chatbot-close" onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-full bg-black/30 text-amber-200/80 hover:bg-black/50"><X className="h-4 w-4" /></button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3" data-testid="chatbot-messages">
              {messages.length === 0 && (
                <div className="rounded-2xl bg-black/25 p-3 text-sm text-amber-100/80 ring-1 ring-amber-300/15">
                  Hi {user?.display_name?.split(" ")[0] || "there"}! 🃏 I&apos;m Zoya. Ask me anything about coins, games, fantasy or your account.
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
                  <button data-testid="chatbot-mic" onClick={startVoice} disabled={busy} title="Speak your question"
                    className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ring-1 ring-amber-300/30 ${listening ? "animate-pulse bg-rose-500 text-white" : "bg-black/30 text-amber-200/80 hover:bg-black/50"}`}>
                    <Mic className="h-4 w-4" />
                  </button>
                  <input
                    data-testid="chatbot-input" value={input} onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") send(); }}
                    placeholder={listening ? "Listening…" : "Ask Zoya…"} disabled={busy}
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
