import { useState, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Check, Plus, Users, Coins, Lock } from "lucide-react";
import { toast } from "sonner";
import { useWallet } from "@/context/WalletContext";
import { CONTEST, PLAYERS } from "@/lib/data";

const ROLES = [
  { key: "WK", label: "Wicket-Keepers" },
  { key: "BAT", label: "Batters" },
  { key: "AR", label: "All-Rounders" },
  { key: "BOWL", label: "Bowlers" },
];
const MAX = 11;

export const TeamBuilder = ({ open, onClose }) => {
  const { joinContest } = useWallet();
  const [picked, setPicked] = useState([]);

  const creditsUsed = useMemo(
    () => picked.reduce((s, id) => s + (PLAYERS.find((p) => p.id === id)?.credits || 0), 0),
    [picked]
  );
  const budgetLeft = +(CONTEST.budget - creditsUsed).toFixed(1);

  const toggle = (p) => {
    setPicked((prev) => {
      if (prev.includes(p.id)) return prev.filter((x) => x !== p.id);
      if (prev.length >= MAX) {
        toast("Team full — 11 players selected");
        return prev;
      }
      if (p.credits > budgetLeft) {
        toast.error("Not enough credits left");
        return prev;
      }
      return [...prev, p.id];
    });
  };

  const canLock = picked.length === MAX;

  const lock = () => {
    if (!canLock) return;
    const ok = joinContest(CONTEST.entryFee);
    if (!ok) {
      toast.error("Not enough coins to join this contest");
      return;
    }
    toast.success("Lineup locked! 🏏", { description: `${CONTEST.name} · −${CONTEST.entryFee} coins` });
    setPicked([]);
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          data-testid="team-builder-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/50 backdrop-blur-sm sm:items-center sm:p-6"
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-background sm:rounded-3xl"
          >
            {/* Header */}
            <div className="flex items-start justify-between border-b border-slate-100 bg-white p-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-flame">{CONTEST.sub}</p>
                <h2 className="font-display text-xl font-extrabold tracking-tight text-slate-900">Build Your XI</h2>
              </div>
              <button
                data-testid="team-builder-close"
                onClick={onClose}
                className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-600 transition-colors hover:bg-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-2 gap-3 border-b border-slate-100 bg-white px-5 pb-4">
              <div className="rounded-2xl bg-royal-light p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-royal">
                  <Users className="h-3.5 w-3.5" /> Players
                </div>
                <p data-testid="picked-count" className="font-display text-lg font-extrabold text-slate-900">
                  {picked.length}<span className="text-sm text-slate-400">/{MAX}</span>
                </p>
              </div>
              <div className="rounded-2xl bg-flame-light p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-flame">
                  <Coins className="h-3.5 w-3.5" /> Credits Left
                </div>
                <p data-testid="credits-left" className="font-display text-lg font-extrabold text-slate-900">
                  {budgetLeft}<span className="text-sm text-slate-400">/{CONTEST.budget}</span>
                </p>
              </div>
            </div>

            {/* Player list */}
            <div className="flex-1 space-y-6 overflow-y-auto p-5">
              {ROLES.map((role) => (
                <div key={role.key}>
                  <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">{role.label}</p>
                  <div className="space-y-2.5">
                    {PLAYERS.filter((p) => p.role === role.key).map((p) => {
                      const isPicked = picked.includes(p.id);
                      const disabled = !isPicked && (picked.length >= MAX || p.credits > budgetLeft);
                      return (
                        <div
                          key={p.id}
                          className={`flex items-center gap-3 rounded-2xl border p-3 transition-colors ${
                            isPicked ? "border-royal/40 bg-royal-light" : "border-slate-100 bg-white"
                          }`}
                        >
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-900 text-xs font-bold text-white">
                            {p.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-slate-900">{p.name}</p>
                            <p className="text-xs text-slate-500">{p.team} · {p.points} pts</p>
                          </div>
                          <span className="text-sm font-bold text-slate-700">{p.credits}<span className="text-xs text-slate-400"> cr</span></span>
                          <button
                            data-testid={`player-toggle-${p.id}`}
                            onClick={() => toggle(p)}
                            disabled={disabled}
                            className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-transform hover:scale-105 ${
                              isPicked
                                ? "bg-royal text-white"
                                : disabled
                                ? "cursor-not-allowed bg-slate-100 text-slate-300"
                                : "bg-mint text-white"
                            }`}
                          >
                            {isPicked ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="border-t border-slate-100 bg-white p-4">
              <button
                data-testid="lock-lineup-btn"
                onClick={lock}
                disabled={!canLock}
                className={`flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold transition-transform ${
                  canLock ? "bg-royal text-white hover:-translate-y-0.5" : "cursor-not-allowed bg-slate-100 text-slate-400"
                }`}
              >
                <Lock className="h-4 w-4" />
                {canLock ? `Lock Lineup · −${CONTEST.entryFee} coins` : `Pick ${MAX - picked.length} more player${MAX - picked.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
