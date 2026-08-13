import { useEffect, useState } from "react";
import axios from "axios";
import { motion, AnimatePresence } from "framer-motion";
import { Gift, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const fmt = (n) => (n || 0).toLocaleString("en-IN");

// Weekly Surprise Box: the reward is HIDDEN until the player taps to open —
// then an animated reveal shows the coins (delivered as playable bonus).
export const SurpriseBox = () => {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [status, setStatus] = useState(null);
  const [opening, setOpening] = useState(false);
  const [revealed, setRevealed] = useState(null);

  useEffect(() => {
    let active = true;
    axios.get(`${API}/wallet/surprise-box`, { headers })
      .then(({ data }) => { if (active) setStatus(data); })
      .catch(() => {});
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const open = async () => {
    setOpening(true);
    try {
      const { data } = await axios.post(`${API}/wallet/surprise-box/open`, {}, { headers });
      setRevealed(data.amount);
      setStatus({ ...status, status: "opened", opened_amount: data.amount });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Couldn't open the box");
    } finally { setOpening(false); }
  };

  if (!status || (status.status !== "ready" && !revealed)) return null;

  return (
    <div className="mt-6 overflow-hidden rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-amber-50 p-6 shadow-soft" data-testid="surprise-box">
      <AnimatePresence mode="wait">
        {revealed == null ? (
          <motion.div key="closed" exit={{ opacity: 0, scale: 0.9 }} className="flex items-center gap-4">
            <motion.div
              animate={{ y: [0, -6, 0], rotate: [-3, 3, -3] }}
              transition={{ repeat: Infinity, duration: 2.4, ease: "easeInOut" }}
              className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-lg">
              <Gift className="h-8 w-8" />
            </motion.div>
            <div className="min-w-0 flex-1">
              <p className="font-display text-lg font-extrabold text-slate-900">Your Weekly Surprise Box is ready!</p>
              <p className="text-sm text-slate-500">A thank-you for playing this week. Tap to reveal your gift.</p>
            </div>
            <button data-testid="surprise-box-open-btn" onClick={open} disabled={opening}
              className="flex shrink-0 items-center gap-1.5 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 py-3 text-sm font-black text-white shadow-lift transition-transform hover:-translate-y-0.5 disabled:opacity-70">
              {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Open
            </button>
          </motion.div>
        ) : (
          <motion.div key="open" initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 220, damping: 16 }} className="text-center" data-testid="surprise-box-reveal">
            <motion.div initial={{ rotate: -20, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }}
              className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-amber-400 to-yellow-600 text-black shadow-lg">
              <Gift className="h-8 w-8" />
            </motion.div>
            <p className="mt-3 text-sm font-semibold text-slate-500">You unlocked</p>
            <p className="font-display text-4xl font-extrabold text-slate-900" data-testid="surprise-box-amount">{fmt(revealed)}</p>
            <p className="text-sm font-bold text-amber-600">bonus coins</p>
            <p className="mt-2 text-xs text-slate-400">Added to your bonus balance — play with them to unlock as real coins.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
