import { Crown } from "lucide-react";
import { motion } from "framer-motion";

export const Logo = ({ compact = false }) => (
  <motion.div
    initial={{ opacity: 0, y: -8 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
    className="flex items-center gap-2.5 select-none"
    data-testid="brand-logo"
  >
    {/* Emblem */}
    <div className="relative grid h-10 w-10 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-flame via-royal to-royal-dark shadow-[0_6px_18px_rgba(200,16,46,0.35)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-white/25" />
      <div className="pointer-events-none absolute -right-2 -top-2 h-6 w-6 rounded-full bg-white/30 blur-md" />
      <Crown className="relative h-5 w-5 text-white drop-shadow" strokeWidth={2.4} />
    </div>
    {!compact && (
      <div className="leading-none">
        <div className="font-display text-xl font-extrabold tracking-tight">
          <span className="bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">ROYAL</span>
          <span className="bg-gradient-to-r from-flame to-royal bg-clip-text text-transparent">11</span>
        </div>
        <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.28em] text-royal/70">Play · Win · Repeat</div>
      </div>
    )}
  </motion.div>
);
