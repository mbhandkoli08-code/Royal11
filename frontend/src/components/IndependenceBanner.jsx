import { useEffect, useState } from "react";
import { X, Gift, Check, Loader2 } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";
import { IndependenceFlag } from "@/components/IndependenceFlag";
import { IndependenceConfetti } from "@/components/IndependenceConfetti";
import { IndependenceMusic } from "@/components/IndependenceMusic";
import { useAuth } from "@/context/AuthContext";
import { useWallet } from "@/context/WalletContext";

const API = process.env.REACT_APP_BACKEND_URL + "/api";
const DISMISS_KEY = "royal11_id_banner_dismissed";

const Dove = ({ style, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="rgba(255,255,255,0.55)" style={style} aria-hidden="true">
    <path d="M2 13c3 0 5-1 7-3 0 3 2 5 5 5 3 0 5-2 6-5 1 2 2 3 2 3s-1-6-6-7c-2-.4-3 .3-4 1-1-2-3-3-5-2 1 1 1 2 1 3-3 0-6 2-6 6l3 1z" />
  </svg>
);

// Festive Independence Day banner — tricolor accents blended into the ROYAL11
// dark/gold luxury aesthetic. Generic symbols only (flag, chakra, doves,
// fireworks) — no real people or names. Dismissible for the day.
export const IndependenceBanner = () => {
  const { token } = useAuth();
  const { refresh } = useWallet();
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === new Date().toDateString()
  );
  const [gift, setGift] = useState(null); // {active, claimed, bonus_coins}
  const [claiming, setClaiming] = useState(false);
  const [sparks, setSparks] = useState([]);

  useEffect(() => {
    if (!token) return;
    axios.get(`${API}/bonus/festival`, { headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => setGift(data)).catch(() => { /* banner still shows */ });
  }, [token]);

  if (dismissed) return null;

  const close = () => {
    localStorage.setItem(DISMISS_KEY, new Date().toDateString());
    setDismissed(true);
  };

  const burst = () => {
    const dots = Array.from({ length: 12 }, (_, i) => {
      const ang = (Math.PI * 2 * i) / 12 + Math.random() * 0.4;
      const dist = 26 + Math.random() * 26;
      return { id: `${Date.now()}-${i}`, dx: `${Math.cos(ang) * dist}px`, dy: `${Math.sin(ang) * dist}px` };
    });
    setSparks(dots);
    setTimeout(() => setSparks([]), 750);
  };

  const claim = async () => {
    if (claiming || gift?.claimed) return;
    setClaiming(true);
    try {
      const { data } = await axios.post(`${API}/bonus/festival/claim`, {},
        { headers: { Authorization: `Bearer ${token}` } });
      burst();
      toast.success(`🎉 Freedom Gift unlocked! +${data.bonus_coins} bonus coins`, {
        description: "Playable now — unlocks to real as you play. Jai Hind! 🇮🇳",
      });
      setGift((g) => ({ ...(g || {}), claimed: true, bonus_coins: data.bonus_coins }));
      refresh && refresh();
    } catch (e) {
      toast.error("Couldn't claim the gift", { description: e.response?.data?.detail || "" });
    } finally {
      setClaiming(false);
    }
  };

  const canClaim = gift?.active && !gift?.claimed;

  return (
    <div
      data-testid="independence-banner"
      className="relative mt-4 overflow-hidden rounded-3xl border border-amber-300/30 p-5 shadow-2xl sm:p-6"
      style={{
        background:
          "linear-gradient(120deg, #14100c 0%, #1c1712 45%, #14100c 100%)",
      }}
    >
      {/* Tricolor top hairline */}
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: "linear-gradient(90deg,#FF9933 0 33%,#ffffff 33% 66%,#138808 66% 100%)" }} />
      {/* Soft tricolor glow accents */}
      <div className="pointer-events-none absolute -left-16 -top-10 h-40 w-40 rounded-full blur-3xl" style={{ background: "radial-gradient(circle,#FF9933,transparent 70%)", opacity: 0.18 }} />
      <div className="pointer-events-none absolute -bottom-12 right-8 h-44 w-44 rounded-full blur-3xl" style={{ background: "radial-gradient(circle,#138808,transparent 70%)", opacity: 0.18 }} />

      {/* Floating doves */}
      <Dove size={22} style={{ position: "absolute", top: 14, right: 120, "--dx": "26px", "--dy": "-18px", animation: "id-dove 6s ease-in-out infinite" }} />
      <Dove size={16} style={{ position: "absolute", top: 40, right: 180, "--dx": "34px", "--dy": "-22px", animation: "id-dove 7.5s ease-in-out 1.2s infinite" }} />

      <IndependenceConfetti />

      <div className="relative z-10 flex items-center gap-5">
        <div className="shrink-0">
          <IndependenceFlag w={104} h={70} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black uppercase tracking-[0.25em] text-amber-300/90">15 August</p>
          <h2 className="mt-0.5 font-display text-2xl font-extrabold leading-tight tracking-tight text-white sm:text-3xl">
            Happy{" "}
            <span style={{ background: "linear-gradient(90deg,#FF9933,#ffffff,#138808)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
              Independence Day
            </span>
          </h2>
          <p className="mt-1 text-sm text-white/60">
            {gift?.claimed
              ? "Your Freedom Gift is in your bonus wallet. Jai Hind! 🇮🇳"
              : "Celebrate freedom with a gift from the ROYAL11 family. Jai Hind! 🇮🇳"}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            {gift?.claimed ? (
              <span
                data-testid="festival-claimed"
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-400/15 px-3.5 py-2 text-sm font-bold text-emerald-300"
              >
                <Check className="h-4 w-4" /> Gift Claimed · +{gift.bonus_coins} coins
              </span>
            ) : (
              <div className="relative">
                <button
                  data-testid="festival-claim-btn"
                  onClick={claim}
                  disabled={!canClaim || claiming}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-extrabold text-[#201203] shadow-lg transition-transform disabled:opacity-60 ${sparks.length ? "id-claim-pop" : ""}`}
                  style={{ background: "linear-gradient(180deg,#FFD25A,#E9B23C)", boxShadow: "0 6px 18px rgba(233,178,60,0.35)" }}
                >
                  {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
                  Claim {gift?.bonus_coins ?? 151} Coins
                </button>
                <span className="id-sparks" data-testid="festival-sparks">
                  {sparks.map((s) => (
                    <span key={s.id} className="id-spark" style={{ "--dx": s.dx, "--dy": s.dy }} />
                  ))}
                </span>
              </div>
            )}
            <IndependenceMusic />
          </div>
        </div>
      </div>

      <button
        data-testid="independence-banner-close"
        onClick={close}
        aria-label="Dismiss"
        className="absolute right-3 top-3 z-20 grid h-8 w-8 place-items-center rounded-full bg-white/10 text-white/70 backdrop-blur transition-colors hover:bg-white/20 hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};
