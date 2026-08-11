import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, X, PartyPopper } from "lucide-react";
import axios from "axios";
import { useAuth } from "@/context/AuthContext";
import { buildWaLink } from "@/lib/whatsapp";

const API = process.env.REACT_APP_BACKEND_URL + "/api";

// One-time welcome shown right after signup: introduces the player to their
// assigned collection Admin + a "Chat on WhatsApp" button (if the Admin set one).
export const WelcomeAgentModal = () => {
  const { token } = useAuth();
  const [agent, setAgent] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (localStorage.getItem("r11_welcome") !== "1" || !token) return;
    (async () => {
      try {
        const { data } = await axios.get(`${API}/wallet/my-agent`, { headers: { Authorization: `Bearer ${token}` } });
        if (data?.admin_name) { setAgent(data); setOpen(true); }
      } catch { /* ignore — non-critical */ }
      finally { localStorage.removeItem("r11_welcome"); }
    })();
  }, [token]);

  const close = () => setOpen(false);
  const wa = agent && buildWaLink(agent.admin_whatsapp, "Hi, I just signed up on ROYAL11");

  return (
    <AnimatePresence>
      {open && agent && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/50 p-4 backdrop-blur-sm sm:items-center"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={close} data-testid="welcome-agent-modal"
        >
          <motion.div
            className="relative w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-lift"
            initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button data-testid="welcome-close" onClick={close} className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"><X className="h-4 w-4" /></button>
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-royal-light text-royal"><PartyPopper className="h-7 w-7" /></span>
            <h2 className="mt-4 font-display text-xl font-extrabold text-slate-900">Welcome to ROYAL11!</h2>
            <p className="mt-2 text-sm text-slate-500">
              Your account manager is <b className="text-slate-800">{agent.admin_name}</b>. Reach out any time for top-ups or help.
            </p>
            {wa ? (
              <a
                data-testid="welcome-whatsapp-btn" href={wa} target="_blank" rel="noopener noreferrer" onClick={close}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#25D366] py-3.5 text-sm font-bold text-white transition-transform hover:scale-[1.01] active:scale-95"
              >
                <MessageCircle className="h-4 w-4" /> Chat on WhatsApp
              </a>
            ) : (
              <p className="mt-5 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-400">Your manager hasn't added a WhatsApp contact yet.</p>
            )}
            <button data-testid="welcome-dismiss" onClick={close} className="mt-3 text-xs font-semibold text-slate-400 hover:text-slate-600">Maybe later</button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
