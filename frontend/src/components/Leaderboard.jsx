import { useState, useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Trophy, Crown, ChevronUp, ChevronDown, Star, Users } from "lucide-react";

const BOTS = ["ProSmasher", "SixMachine", "PitchPirate", "GullyGod", "CoverDrive", "YorkerKing", "BoundaryBoss"];

const rankTint = (rank) =>
  rank === 1 ? "bg-[#FEF3C7] text-[#D97706]" : rank === 2 ? "bg-slate-100 text-slate-500" : rank === 3 ? "bg-flame-light text-flame" : "bg-slate-50 text-slate-400";

export const Leaderboard = ({ open, onClose, team }) => {
  const [rows, setRows] = useState([]);
  const [showTeam, setShowTeam] = useState(false);
  const [rankDir, setRankDir] = useState(0);
  const prevRank = useRef(null);

  useEffect(() => {
    if (!open || !team) return;
    setShowTeam(false);
    setRankDir(0);
    prevRank.current = null;
    const base = team.points || 420;
    const init = [
      { id: "you", name: "You", pts: base, you: true },
      ...BOTS.map((n, i) => ({ id: "b" + i, name: n, pts: Math.round(base + (Math.random() * 130 - 65)) })),
    ];
    setRows(init);
    const iv = setInterval(() => {
      setRows((prev) => prev.map((r) => ({ ...r, pts: r.pts + Math.floor(Math.random() * (r.you ? 16 : 11)) })));
    }, 1800);
    return () => clearInterval(iv);
  }, [open, team]);

  const sorted = useMemo(() => [...rows].sort((a, b) => b.pts - a.pts), [rows]);
  const youRank = sorted.findIndex((r) => r.you) + 1;

  useEffect(() => {
    if (youRank <= 0) return;
    if (prevRank.current != null) {
      if (youRank < prevRank.current) setRankDir(1);
      else if (youRank > prevRank.current) setRankDir(-1);
    }
    prevRank.current = youRank;
  }, [youRank]);

  return (
    <AnimatePresence>
      {open && team && (
        <motion.div
          data-testid="leaderboard-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/50 backdrop-blur-sm sm:items-center sm:p-6"
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl bg-background sm:rounded-3xl"
          >
            {/* Header */}
            <div className="flex items-start justify-between border-b border-slate-100 bg-white p-5">
              <div>
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-red-500">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-red-400" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
                  </span>
                  Live · IPL Grand League
                </p>
                <h2 className="font-display text-xl font-extrabold tracking-tight text-slate-900">Leaderboard</h2>
              </div>
              <button
                data-testid="leaderboard-close"
                onClick={onClose}
                className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-600 transition-colors hover:bg-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Your rank hero */}
            <div className="relative overflow-hidden bg-royal p-5 text-white">
              <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-flame/40 blur-3xl" />
              <div className="relative flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-indigo-100">Your Rank</p>
                  <div className="flex items-end gap-2">
                    <motion.span
                      key={youRank}
                      initial={{ y: -8, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      data-testid="your-rank"
                      className="font-display text-4xl font-extrabold"
                    >
                      #{youRank}
                    </motion.span>
                    <span className="mb-1.5 text-sm text-indigo-100">of {rows.length}</span>
                    {rankDir === 1 && <ChevronUp data-testid="rank-up" className="mb-2 h-6 w-6 text-emerald-300" />}
                    {rankDir === -1 && <ChevronDown data-testid="rank-down" className="mb-2 h-6 w-6 text-red-300" />}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-medium text-indigo-100">Your Points</p>
                  <motion.p
                    key={sorted.find((r) => r.you)?.pts}
                    initial={{ scale: 1.15, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    data-testid="your-points"
                    className="font-display text-3xl font-extrabold"
                  >
                    {sorted.find((r) => r.you)?.pts ?? 0}
                  </motion.p>
                </div>
              </div>
              <div className="relative mt-4 flex items-center gap-2 rounded-2xl bg-white/10 px-3 py-2 text-xs font-medium text-indigo-50">
                <Trophy className="h-4 w-4 text-amber-300" /> Prize pool 1,00,000 coins · Top 40% win
              </div>
              {team.roster && (
                <button
                  data-testid="toggle-team-btn"
                  onClick={() => setShowTeam((s) => !s)}
                  className="relative mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-white/15 px-3 py-2.5 text-xs font-bold text-white transition-colors hover:bg-white/25"
                >
                  <Users className="h-4 w-4" /> {showTeam ? "Hide My XI" : "View My XI"}
                </button>
              )}
            </div>

            {/* Team preview */}
            <AnimatePresence initial={false}>
              {showTeam && team.roster && (
                <motion.div
                  key="roster"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden border-b border-slate-100 bg-white"
                  data-testid="team-preview"
                >
                  <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3">
                    {team.roster.map((p) => (
                      <div key={p.id} data-testid={`roster-${p.id}`} className="flex items-center gap-2 rounded-2xl bg-slate-50 p-2.5">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-900 text-[10px] font-bold text-white">
                          {p.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold text-slate-800">{p.name}</p>
                          <p className="text-[10px] text-slate-500">{p.team} · {p.role}</p>
                        </div>
                        {p.tag === "C" && (
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-flame text-white" title="Captain 2x">
                            <Crown className="h-3.5 w-3.5" />
                          </span>
                        )}
                        {p.tag === "VC" && (
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-royal text-white" title="Vice-Captain 1.5x">
                            <Star className="h-3.5 w-3.5" />
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Rows */}
            <div className="flex-1 space-y-2 overflow-y-auto p-4" data-testid="leaderboard-list">
              {sorted.map((r, i) => {
                const rank = i + 1;
                return (
                  <motion.div
                    key={r.id}
                    layout
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                    data-testid={`lb-row-${r.id}`}
                    className={`flex items-center gap-3 rounded-2xl p-3 ${
                      r.you ? "bg-royal-light ring-2 ring-royal/30" : "bg-white shadow-soft"
                    }`}
                  >
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-extrabold ${rankTint(rank)}`}>
                      {rank === 1 ? <Crown className="h-4 w-4" /> : rank}
                    </span>
                    <span className={`flex-1 truncate text-sm font-bold ${r.you ? "text-royal" : "text-slate-800"}`}>
                      {r.name}
                    </span>
                    <span className="font-display text-sm font-extrabold text-slate-900">{r.pts}</span>
                    <span className="text-[11px] font-semibold text-slate-400">pts</span>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
