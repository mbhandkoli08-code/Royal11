import { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

const BOWLERS = ["Bumrah", "Boult", "Chahar", "Santner"];
const BATTERS = ["Rohit", "Suryakumar", "Tilak", "Ishan"];
const CRIC_OUTCOMES = ["0", "1", "1", "2", "0", "4", "1", "6", "W", "1", "0", "4"];
const FOOT_EVENTS = [
  { t: "Shot saved by the keeper", k: "normal" },
  { t: "Corner kick won", k: "normal" },
  { t: "Dangerous free kick", k: "normal" },
  { t: "Yellow card shown", k: "wicket" },
  { t: "GOAL!!! What a finish!", k: "goal" },
  { t: "Offside flag raised", k: "normal" },
  { t: "Great tackle in midfield", k: "normal" },
];

const kindStyle = {
  four: "bg-mint-light text-mint",
  six: "bg-royal-light text-royal",
  wicket: "bg-[#FEE2E2] text-[#DC2626]",
  goal: "bg-flame-light text-flame",
  normal: "bg-slate-100 text-slate-500",
};

export const MatchDetail = ({ open, onClose, match }) => {
  const [feed, setFeed] = useState([]);
  const [state, setState] = useState(null);
  const idRef = useRef(0);

  useEffect(() => {
    if (!open || !match) return;
    const isCric = match.id === "cric";
    let init;
    if (isCric) {
      const [runs, wkts] = match.teamA.score.split("/").map(Number);
      const [ov, ball] = match.teamA.ov.split(".").map(Number);
      init = { isCric, runs, wkts, ov, ball, min: 0, a: Number(match.teamA.score), b: Number(match.teamB.score) };
    } else {
      init = { isCric, a: Number(match.teamA.score), b: Number(match.teamB.score), min: parseInt(match.note, 10) || 67 };
    }
    setState(init);
    setFeed([]);

    const iv = setInterval(() => {
      setState((s) => {
        if (!s) return s;
        if (s.isCric) {
          let { runs, wkts, ov, ball } = s;
          ball += 1;
          if (ball > 5) { ball = 0; ov += 1; }
          const oc = CRIC_OUTCOMES[Math.floor(Math.random() * CRIC_OUTCOMES.length)];
          const bowler = BOWLERS[Math.floor(Math.random() * BOWLERS.length)];
          const batter = BATTERS[Math.floor(Math.random() * BATTERS.length)];
          let text, kind = "normal";
          if (oc === "W") { if (wkts < 9) wkts += 1; text = "OUT! Big wicket falls"; kind = "wicket"; }
          else { const n = Number(oc); runs += n; text = n === 4 ? "FOUR! Races to the fence" : n === 6 ? "SIX! Into the crowd" : n === 0 ? "no run" : `${n} run${n > 1 ? "s" : ""}`; kind = n === 4 ? "four" : n === 6 ? "six" : "normal"; }
          idRef.current += 1;
          setFeed((f) => [{ id: idRef.current, label: `${ov}.${ball || 6}`, who: `${bowler} to ${batter}`, text, kind }, ...f].slice(0, 30));
          return { ...s, runs, wkts, ov, ball };
        } else {
          let { a, b, min } = s;
          min += Math.floor(Math.random() * 2) + 1;
          const ev = FOOT_EVENTS[Math.floor(Math.random() * FOOT_EVENTS.length)];
          let text = ev.t, kind = ev.k;
          if (ev.k === "goal") { Math.random() < 0.5 ? (a += 1) : (b += 1); }
          idRef.current += 1;
          setFeed((f) => [{ id: idRef.current, label: `${min}'`, who: "", text, kind }, ...f].slice(0, 30));
          return { ...s, a, b, min };
        }
      });
    }, 2000);
    return () => clearInterval(iv);
  }, [open, match]);

  const isCric = state?.isCric;
  const scoreA = isCric ? `${state.runs}/${state.wkts}` : state?.a;
  const scoreB = isCric ? match?.teamB.score : state?.b;
  const crr = isCric && state ? ((state.runs / (state.ov + state.ball / 6)) || 0).toFixed(2) : null;

  return (
    <AnimatePresence>
      {open && match && state && (
        <motion.div
          data-testid="match-detail-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[75] flex items-end justify-center bg-slate-900/50 backdrop-blur-sm sm:items-center sm:p-6"
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl bg-background sm:rounded-3xl"
          >
            {/* Scoreboard */}
            <div className="relative overflow-hidden bg-slate-900 p-5 text-white">
              <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-flame/30 blur-3xl" />
              <div className="relative flex items-center justify-between">
                <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold">{match.league}</span>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5 rounded-full bg-red-500 px-2.5 py-1 text-[11px] font-bold">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-white" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
                    </span>
                    LIVE
                  </span>
                  <button
                    data-testid="match-detail-close"
                    onClick={onClose}
                    className="grid h-8 w-8 place-items-center rounded-lg bg-white/15 text-white transition-colors hover:bg-white/25"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <p className="relative mt-4 text-xs font-medium text-slate-400">{match.sport}</p>
              <div className="relative mt-2 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold">{match.teamA.name}</span>
                  <motion.span key={"a" + scoreA} initial={{ scale: 1.15, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} data-testid="detail-score-a" className="font-display text-2xl font-extrabold">
                    {scoreA}{isCric && <span className="ml-1 text-sm font-medium text-slate-400">({state.ov}.{state.ball})</span>}
                  </motion.span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold">{match.teamB.name}</span>
                  <span className="font-display text-2xl font-extrabold">{scoreB}</span>
                </div>
              </div>
              <div className="relative mt-4 flex items-center gap-2 rounded-2xl bg-white/10 px-3 py-2 text-xs font-medium">
                {isCric ? <span className="text-amber-300">Current Run Rate: {crr}</span> : <span className="text-amber-300">{state.min}' · Second half</span>}
              </div>
            </div>

            {/* Commentary */}
            <div className="flex items-center justify-between px-5 pb-2 pt-4">
              <h3 className="font-display text-base font-bold text-slate-900">Ball-by-Ball</h3>
              <span className="text-xs font-semibold text-slate-400">Live commentary</span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto px-5 pb-5" data-testid="commentary-feed">
              {feed.length === 0 && <p className="py-8 text-center text-sm text-slate-400">Waiting for the next delivery…</p>}
              <AnimatePresence initial={false}>
                {feed.map((f) => (
                  <motion.div
                    key={`${match.id}-${f.id}`}
                    layout
                    initial={{ opacity: 0, x: -14 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-soft"
                  >
                    <span className={`grid h-9 min-w-9 shrink-0 place-items-center rounded-lg px-1.5 text-[11px] font-extrabold ${kindStyle[f.kind]}`}>
                      {f.label}
                    </span>
                    <div className="min-w-0 flex-1">
                      {f.who && <p className="truncate text-xs font-semibold text-slate-500">{f.who}</p>}
                      <p className="truncate text-sm font-bold text-slate-800">{f.text}</p>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
