import { useState } from "react";
import { X, Check, Coins, Sparkles, Crown } from "lucide-react";

// VISUAL-ONLY "Get Coins" demo modal. Shows virtual coin packs and a visual
// confirmation. Does NOT credit/debit coins and never calls the wallet/backend.
// The real deposit feature (AddCoins) remains separate and unchanged.

const PACKS = [
  { id: 1000, coins: 1000, tag: "Starter" },
  { id: 5000, coins: 5000, tag: "Popular" },
  { id: 10000, coins: 10000, tag: "Best value", best: true },
];

const fmt = (n) => n.toLocaleString("en-IN");

export function GetCoinsDemo({ open, onClose }) {
  const [confirmed, setConfirmed] = useState(null);
  if (!open) return null;

  const close = () => { setConfirmed(null); onClose?.(); };

  return (
    <div
      data-testid="get-coins-modal"
      className="fixed inset-0 z-[150] grid place-items-center p-3"
      style={{ background: "rgba(6,2,3,0.72)", backdropFilter: "blur(6px)",
        paddingLeft: "calc(env(safe-area-inset-left) + 12px)", paddingRight: "calc(env(safe-area-inset-right) + 12px)",
        paddingTop: "calc(env(safe-area-inset-top) + 10px)", paddingBottom: "calc(env(safe-area-inset-bottom) + 10px)" }}
    >
      <div
        className="relative w-full max-w-[520px] overflow-hidden rounded-2xl text-white"
        style={{ background: "radial-gradient(120% 120% at 50% -10%, #4a0e19 0%, #250810 46%, #120406 100%)",
          border: "1px solid rgba(201,154,46,0.45)", boxShadow: "0 24px 70px rgba(0,0,0,0.6)" }}
      >
        {/* thin gold top accent */}
        <span className="absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(233,198,103,0.8), transparent)" }} />

        <button data-testid="get-coins-close" onClick={close} aria-label="Close"
          className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full bg-black/45 text-white/70 ring-1 ring-white/15 transition-colors hover:text-white hover:bg-black/70">
          <X className="h-4 w-4" />
        </button>

        <div className="px-5 pt-4 pb-5 sm:px-6">
          {/* Header */}
          <div className="flex items-center gap-2 text-[var(--r-gold,#e9c667)]">
            <Coins className="h-5 w-5" strokeWidth={2.2} />
            <h2 className="font-display text-lg font-black uppercase tracking-wide">Get Coins</h2>
          </div>
          <span data-testid="get-coins-demo-badge"
            className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[var(--r-gold,#e9c667)]/40 bg-black/40 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--r-gold,#e9c667)]">
            <Sparkles className="h-3 w-3" /> Demo / Visual Preview
          </span>

          {!confirmed ? (
            <>
              <div className="mt-3 grid grid-cols-3 gap-2.5" data-testid="get-coins-packs">
                {PACKS.map((p) => (
                  <button
                    key={p.id}
                    data-testid={`get-coins-pack-${p.id}`}
                    onClick={() => setConfirmed(p)}
                    className="group relative flex flex-col items-center gap-1 rounded-xl px-2 py-3 transition-transform hover:-translate-y-0.5 active:scale-[0.97]"
                    style={{ background: p.best ? "linear-gradient(180deg, rgba(233,198,103,0.16), rgba(122,20,32,0.35))" : "rgba(255,255,255,0.05)",
                      border: `1px solid ${p.best ? "rgba(233,198,103,0.7)" : "rgba(255,255,255,0.12)"}` }}
                  >
                    {p.best && (
                      <span data-testid="get-coins-best-value"
                        className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-[#2a0a10]"
                        style={{ background: "linear-gradient(90deg,#f4d98b,#e9c667)" }}>
                        <Crown className="mr-0.5 inline h-2.5 w-2.5" fill="currentColor" />Best value
                      </span>
                    )}
                    <span className="grid h-9 w-9 place-items-center rounded-full"
                      style={{ background: "radial-gradient(circle at 35% 30%, #fff7dd, #e9c667 70%, #b9882a)" }}>
                      <Coins className="h-4.5 w-4.5 text-[#5a3a08]" style={{ width: 18, height: 18 }} />
                    </span>
                    <b className="mt-0.5 text-base font-black leading-none text-white">{fmt(p.coins)}</b>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-white/50">{p.tag}</span>
                  </button>
                ))}
              </div>
              <p className="mt-3 text-center text-[11px] leading-snug text-white/45">
                Visual preview only — no real coins are added and no payment is taken.
              </p>
              <button data-testid="get-coins-cancel" onClick={close}
                className="mt-3 w-full rounded-full border border-white/15 bg-white/[0.04] py-2.5 text-xs font-bold uppercase tracking-widest text-white/70 transition-colors hover:bg-white/10 hover:text-white">
                Close
              </button>
            </>
          ) : (
            <div data-testid="get-coins-confirm" className="mt-4 flex flex-col items-center text-center">
              <span className="grid h-14 w-14 place-items-center rounded-full" style={{ background: "rgba(52,211,153,0.15)", border: "1px solid rgba(52,211,153,0.5)" }}>
                <Check className="h-7 w-7 text-emerald-400" strokeWidth={3} />
              </span>
              <b className="mt-3 text-xl font-black text-[var(--r-gold,#e9c667)]">{fmt(confirmed.coins)} coins</b>
              <p className="mt-1 text-sm font-semibold text-white/80">Added in this preview</p>
              <p className="mt-1 text-[11px] leading-snug text-white/45">Demo only — no real coins were credited to your balance.</p>
              <button data-testid="get-coins-done" onClick={close}
                className="mt-4 w-full rounded-full py-2.5 text-xs font-black uppercase tracking-widest text-[#2a0a10]"
                style={{ background: "linear-gradient(90deg,#f4d98b,#e9c667)" }}>
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
