import { useState } from "react";
import { X } from "lucide-react";
import { IndependenceFlag } from "@/components/IndependenceFlag";
import { IndependenceConfetti } from "@/components/IndependenceConfetti";
import { IndependenceMusic } from "@/components/IndependenceMusic";

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
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === new Date().toDateString()
  );
  if (dismissed) return null;

  const close = () => {
    localStorage.setItem(DISMISS_KEY, new Date().toDateString());
    setDismissed(true);
  };

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
          <p className="mt-1 text-sm text-white/60">Celebrating the spirit of freedom with the ROYAL11 family. Jai Hind! 🇮🇳</p>
          <div className="mt-3 flex items-center gap-2">
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
