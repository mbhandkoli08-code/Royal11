import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Sparkles, Coins } from "lucide-react";
import { toast } from "sonner";
import { useWallet } from "@/context/WalletContext";

const SPIN_COST = 150;
// 8 segments, clockwise from top
const PRIZES = [50, 200, 0, 500, 100, 1000, 75, 300];
const COLORS = ["#4F46E5", "#F97316", "#6366F1", "#10B981", "#4F46E5", "#F97316", "#6366F1", "#10B981"];
const SEG = 360 / PRIZES.length;

export const RewardWheel = ({ open, onClose }) => {
  const { balance, spend, credit } = useWallet();
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(null);

  const spin = () => {
    if (spinning) return;
    const ok = spend(SPIN_COST, "Lucky Spin", "Reward wheel", "Sparkles");
    if (!ok) {
      toast.error("Not enough coins to spin", { description: `You need ${SPIN_COST - balance} more.` });
      return;
    }
    setSpinning(true);
    setResult(null);
    const idx = Math.floor(Math.random() * PRIZES.length);
    const prize = PRIZES[idx];
    // land the winning segment center under the top pointer
    const target = 360 * 6 + (360 - (idx * SEG + SEG / 2));
    setRotation((r) => r - (r % 360) + target);
    setTimeout(() => {
      setSpinning(false);
      setResult(prize);
      if (prize > 0) {
        const won = credit(prize, "Lucky Spin Win", "Reward wheel", "Sparkles");
        toast.success(`You won ${won} coins! 🎉`);
      } else {
        toast("No luck this time — spin again!");
      }
    }, 4200);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          data-testid="reward-wheel-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-6"
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.92, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className="w-full max-w-sm overflow-hidden rounded-3xl bg-white p-6 text-center"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-extrabold tracking-tight text-slate-900">Lucky Spin</h2>
              <button
                data-testid="reward-wheel-close"
                onClick={onClose}
                className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-600 transition-colors hover:bg-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-sm text-slate-500">Spin to win up to 1,000 coins</p>

            {/* Wheel */}
            <div className="relative mx-auto mt-6 h-64 w-64">
              <div className="absolute left-1/2 top-[-6px] z-10 -translate-x-1/2">
                <div className="h-0 w-0 border-l-[12px] border-r-[12px] border-t-[20px] border-l-transparent border-r-transparent border-t-slate-900" />
              </div>
              <motion.div
                data-testid="wheel-dial"
                className="h-full w-full rounded-full shadow-lift"
                style={{
                  background: `conic-gradient(${PRIZES.map(
                    (_, i) => `${COLORS[i]} ${i * SEG}deg ${(i + 1) * SEG}deg`
                  ).join(", ")})`,
                }}
                animate={{ rotate: rotation }}
                transition={{ duration: 4, ease: [0.18, 0.9, 0.2, 1] }}
              >
                {PRIZES.map((p, i) => (
                  <div
                    key={i}
                    className="absolute left-1/2 top-1/2 origin-left"
                    style={{ transform: `rotate(${i * SEG + SEG / 2}deg)` }}
                  >
                    <span className="ml-14 inline-block -translate-y-1/2 text-xs font-extrabold text-white drop-shadow">
                      {p === 0 ? "✕" : p}
                    </span>
                  </div>
                ))}
              </motion.div>
              <div className="absolute left-1/2 top-1/2 grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white shadow-soft">
                <Sparkles className="h-6 w-6 text-flame" />
              </div>
            </div>

            {result !== null && !spinning && (
              <motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                data-testid="wheel-result"
                className="mt-5 text-sm font-bold text-slate-700"
              >
                {result > 0 ? `🎉 You won ${result} coins!` : "No win — try again!"}
              </motion.p>
            )}

            <button
              data-testid="spin-btn"
              onClick={spin}
              disabled={spinning}
              className={`mt-5 flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold text-white transition-transform ${
                spinning ? "cursor-not-allowed bg-slate-300" : "bg-royal hover:-translate-y-0.5"
              }`}
            >
              <Coins className="h-4 w-4" /> {spinning ? "Spinning…" : `Spin · ${SPIN_COST} coins`}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
