import { RotateCw, Smartphone, LogOut, Crown } from "lucide-react";

// Premium full-screen "Rotate your phone to play" gate shown when a phone is
// held in portrait on the Rummy table. Desktop/tablet never see this. When the
// device is turned to landscape, orientation detection hides this gate and the
// approved game table renders automatically (handled in RummyTable.applyFrame).
export const RotateToPlay = ({ onLeave }) => (
  <div
    data-testid="rummy-rotate-screen"
    className="fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden text-center text-white"
    style={{
      background: "radial-gradient(120% 85% at 50% 0%, #45101a 0%, #24070c 48%, #0b0405 100%)",
      paddingTop: "calc(env(safe-area-inset-top) + 20px)",
      paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)",
      paddingLeft: "calc(env(safe-area-inset-left) + 24px)",
      paddingRight: "calc(env(safe-area-inset-right) + 24px)",
    }}
  >
    {/* Compact Crown + wordmark branding */}
    <div className="flex items-center gap-2 text-[var(--r-gold,#e9c667)]" data-testid="rotate-brand">
      <Crown className="h-5 w-5" strokeWidth={2.2} fill="currentColor" />
      <span className="font-display text-base font-black uppercase tracking-[0.32em]">R11 Rummy</span>
    </div>

    {/* Thin gold divider */}
    <span className="mt-4 h-px w-24 bg-gradient-to-r from-transparent via-[var(--r-gold,#e9c667)]/60 to-transparent" />

    {/* Animated rotating phone inside a gold ring + soft glow */}
    <div className="relative my-9 grid place-items-center" data-testid="rotate-anim">
      <span className="absolute h-40 w-40 rounded-full bg-[var(--r-gold,#e9c667)]/10 blur-2xl" />
      <span className="absolute h-32 w-32 rounded-full border border-[var(--r-gold,#e9c667)]/25" />
      <div className="rotate-phone grid h-24 w-24 place-items-center rounded-full border border-[var(--r-gold,#e9c667)]/40 bg-black/40 shadow-[0_10px_40px_rgba(0,0,0,0.55)]">
        <Smartphone className="h-12 w-12 text-[var(--r-gold,#e9c667)]" strokeWidth={1.6} />
      </div>
      <RotateCw className="rotate-hint absolute -right-3 -top-2 h-7 w-7 text-white/75" strokeWidth={2.4} />
    </div>

    <h1 className="px-6 font-display text-2xl font-black uppercase tracking-wide text-white">
      Rotate your phone to play
    </h1>
    <p className="mt-2 text-sm font-medium text-white/55" data-testid="rotate-subtext">
      Rummy gameplay works best in landscape
    </p>

    <button
      type="button"
      data-testid="rotate-leave-btn"
      onClick={onLeave}
      className="mt-10 inline-flex items-center gap-2 rounded-full border border-[var(--r-gold,#e9c667)]/25 bg-white/[0.04] px-6 py-2.5 text-xs font-bold uppercase tracking-widest text-white/70 transition-colors hover:bg-white/10 hover:text-white"
    >
      <LogOut className="h-3.5 w-3.5" /> Leave table
    </button>
  </div>
);
