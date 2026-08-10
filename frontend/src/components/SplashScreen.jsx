import { useMemo } from "react";
import { motion } from "framer-motion";
import logo from "@/assets/royal11-logo.png";

// Deterministic-ish scattered sparkle positions (percentages).
const SPARKLES = [
  { top: "12%", left: "18%", size: 3, dur: "2.2s", delay: "0s" },
  { top: "22%", left: "78%", size: 2, dur: "2.8s", delay: "0.4s" },
  { top: "34%", left: "8%", size: 2, dur: "3.1s", delay: "0.9s" },
  { top: "18%", left: "52%", size: 2, dur: "2.5s", delay: "1.2s" },
  { top: "68%", left: "14%", size: 3, dur: "2.9s", delay: "0.2s" },
  { top: "74%", left: "82%", size: 2, dur: "2.3s", delay: "0.7s" },
  { top: "82%", left: "40%", size: 2, dur: "3.3s", delay: "1.1s" },
  { top: "58%", left: "90%", size: 3, dur: "2.6s", delay: "0.5s" },
  { top: "8%", left: "88%", size: 2, dur: "3.0s", delay: "1.4s" },
  { top: "88%", left: "62%", size: 2, dur: "2.4s", delay: "0.3s" },
  { top: "44%", left: "72%", size: 2, dur: "2.7s", delay: "1.0s" },
  { top: "30%", left: "34%", size: 2, dur: "3.2s", delay: "0.6s" },
];

export const SplashScreen = ({ onFinish }) => {
  const sparkles = useMemo(() => SPARKLES, []);

  return (
    <motion.div
      data-testid="splash-screen"
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden"
      style={{ backgroundColor: "#050102" }}
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6, ease: "easeInOut" }}
      onAnimationComplete={() => {
        // Hand off after ~2.3s total.
        setTimeout(() => onFinish?.(), 2300);
      }}
    >
      {/* Edge vignette */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(circle at 50% 45%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.85) 100%)" }}
      />

      {/* Sparkles */}
      {sparkles.map((s, i) => (
        <span
          key={i}
          className="r11-twinkle pointer-events-none absolute rounded-full bg-amber-200"
          style={{
            top: s.top,
            left: s.left,
            width: s.size,
            height: s.size,
            boxShadow: "0 0 6px 1px rgba(253,224,71,0.7)",
            "--twk-dur": s.dur,
            animationDelay: s.delay,
          }}
        />
      ))}

      {/* Primary cherry-red/gold glow (~340px) */}
      <motion.div
        className="pointer-events-none absolute rounded-full"
        style={{
          width: 340,
          height: 340,
          background: "radial-gradient(circle, rgba(200,16,46,0.55) 0%, rgba(180,120,20,0.35) 45%, rgba(5,1,2,0) 72%)",
          filter: "blur(28px)",
        }}
        initial={{ opacity: 0.5, scale: 0.9 }}
        animate={{ opacity: [0.5, 0.85, 0.5], scale: [0.9, 1.05, 0.9] }}
        transition={{ duration: 2.6, ease: "easeInOut", repeat: Infinity }}
      />

      {/* Secondary gold glow (~180px) */}
      <motion.div
        className="pointer-events-none absolute rounded-full"
        style={{
          width: 180,
          height: 180,
          background: "radial-gradient(circle, rgba(253,224,71,0.5) 0%, rgba(253,224,71,0) 70%)",
          filter: "blur(20px)",
        }}
        initial={{ opacity: 0.4, scale: 0.85 }}
        animate={{ opacity: [0.4, 0.75, 0.4], scale: [0.85, 1.1, 0.85] }}
        transition={{ duration: 2.2, ease: "easeInOut", repeat: Infinity }}
      />

      {/* Logo badge */}
      <motion.div
        className="relative"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1] }}
      >
        <div
          className="relative overflow-hidden shadow-[0_20px_60px_rgba(200,16,46,0.45)] ring-1 ring-amber-300/40"
          style={{ width: 200, height: 200, borderRadius: 28 }}
        >
          <img src={logo} alt="ROYAL11" className="h-full w-full object-cover" draggable={false} />
        </div>
      </motion.div>

      {/* Taglines */}
      <motion.div
        className="relative mt-8 text-center"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.35, ease: "easeOut" }}
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.32em] text-amber-300" data-testid="splash-tagline">
          Premium Sports &amp; Gaming
        </p>
        <p className="mt-2 text-sm font-medium text-slate-400">Virtual Coins Platform</p>
      </motion.div>

      {/* iOS-style home indicator */}
      <div className="pointer-events-none absolute bottom-2.5 left-1/2 h-1 w-32 -translate-x-1/2 rounded-full bg-white/70" />
    </motion.div>
  );
};
