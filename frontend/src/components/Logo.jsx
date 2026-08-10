import { motion } from "framer-motion";
import logoSm from "@/assets/royal11-logo-sm.png";

export const Logo = ({ compact = false }) => (
  <motion.div
    initial={{ opacity: 0, y: -8 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
    className="flex items-center gap-3 select-none"
    data-testid="brand-logo"
  >
    {/* Crest + thin gold accent bar */}
    <div className="flex items-center gap-2.5">
      <div className="relative h-11 w-11 overflow-hidden rounded-2xl ring-1 ring-amber-300/40 shadow-[0_6px_18px_rgba(200,16,46,0.35)]">
        <img src={logoSm} alt="ROYAL11" className="h-full w-full object-cover" draggable={false} />
      </div>
      <span className="h-9 w-[3px] rounded-full bg-gradient-to-b from-amber-300 via-amber-400 to-amber-600" />
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
