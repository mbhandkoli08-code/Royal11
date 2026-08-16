import { RotateCw, Smartphone, LogOut } from "lucide-react";

// Premium full-screen "Rotate your phone to play" gate shown when a phone is
// held in portrait on the Rummy table. Desktop/tablet never see this.
export const RotateToPlay = ({ onLeave }) => (
  <div
    data-testid="rummy-rotate-screen"
    className="fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden text-center text-white"
    style={{
      background: "radial-gradient(120% 90% at 50% 0%, #3a0d14 0%, #1a0508 55%, #0b0405 100%)",
      paddingTop: "env(safe-area-inset-top)",
      paddingBottom: "env(safe-area-inset-bottom)",
      paddingLeft: "env(safe-area-inset-left)",
      paddingRight: "env(safe-area-inset-right)",
    }}
  >
    <div className="mb-2 flex items-center gap-2 text-[var(--r-gold,#e9c667)]">
      <span className="font-display text-lg font-black uppercase tracking-[0.2em]">R11 RUMMY</span>
    </div>

    <div className="relative my-6 grid place-items-center" data-testid="rotate-anim">
      <div className="rotate-phone">
        <Smartphone className="h-16 w-16 text-[var(--r-gold,#e9c667)]" strokeWidth={1.6} />
      </div>
      <RotateCw className="absolute -right-6 -top-4 h-7 w-7 text-white/70 rotate-hint" strokeWidth={2} />
    </div>

    <h1 className="px-8 font-display text-xl font-black uppercase tracking-wide text-white">
      Rotate your phone to play
    </h1>
    <p className="mt-2 max-w-xs px-8 text-sm text-white/60">
      ROYAL 11 Rummy is best played in landscape. Turn your device sideways to sit at the table.
    </p>

    <button
      type="button"
      data-testid="rotate-leave-btn"
      onClick={onLeave}
      className="mt-8 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-2 text-xs font-bold uppercase tracking-widest text-white/70 transition-colors hover:bg-white/10"
    >
      <LogOut className="h-3.5 w-3.5" /> Leave table
    </button>
  </div>
);
