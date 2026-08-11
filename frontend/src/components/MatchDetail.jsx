import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Sparkles, TrendingUp, Loader2, Clock, Trophy, CalendarClock } from "lucide-react";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const teamScore = (t) => (t?.score ? `${t.score}${t.ov ? ` (${t.ov})` : ""}` : "—");

const formatStart = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
};

export const MatchDetail = ({ open, onClose, match }) => {
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // AI-generated match preview (Gemini) — fetched once per match open.
  useEffect(() => {
    if (!open || !match) return;
    let active = true;
    setPreview(null);
    setPreviewLoading(true);
    axios
      .post(`${API}/match/preview`, {
        sport: match.sport,
        league: match.league,
        team_a: match.teamA.name,
        team_b: match.teamB.name,
        context: match.note || match.status || "upcoming match",
      })
      .then(({ data }) => { if (active) setPreview(data); })
      .catch(() => {})
      .finally(() => { if (active) setPreviewLoading(false); });
    return () => { active = false; };
  }, [open, match]);

  if (!open || !match) return null;

  const startLabel = formatStart(match.starting_at);
  const hasScores = Boolean(match.teamA.score || match.teamB.score);

  return (
    <AnimatePresence>
      {open && match && (
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
            {/* Scoreboard (real data only) */}
            <div className="relative overflow-hidden bg-slate-900 p-5 text-white">
              <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-flame/30 blur-3xl" />
              <div className="relative flex items-center justify-between">
                <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold">{match.league}</span>
                <div className="flex items-center gap-3">
                  {match.live && (
                    <span data-testid="detail-live-badge" className="flex items-center gap-1.5 rounded-full bg-red-500 px-2.5 py-1 text-[11px] font-bold">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-white" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
                      </span>
                      LIVE
                    </span>
                  )}
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
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-lg font-bold">{match.teamA.full || match.teamA.name}</span>
                  <span data-testid="detail-score-a" className="shrink-0 font-display text-2xl font-extrabold">{teamScore(match.teamA)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-lg font-bold">{match.teamB.full || match.teamB.name}</span>
                  <span data-testid="detail-score-b" className="shrink-0 font-display text-2xl font-extrabold">{teamScore(match.teamB)}</span>
                </div>
              </div>
              <div className="relative mt-4 flex items-center gap-2 rounded-2xl bg-white/10 px-3 py-2 text-xs font-medium">
                {match.live ? (
                  <span className="text-amber-300">{match.note || "Live now"}</span>
                ) : hasScores ? (
                  <span className="flex items-center gap-1.5 text-amber-300"><Trophy className="h-3.5 w-3.5" /> {match.note || "Result"}</span>
                ) : (
                  <span className="flex items-center gap-1.5 text-amber-300"><Clock className="h-3.5 w-3.5" /> {startLabel ? `Starts ${startLabel}` : (match.note || "Not started yet")}</span>
                )}
              </div>
            </div>

            {/* AI Match Preview (Gemini) */}
            <div className="border-b border-slate-100 px-5 py-4" data-testid="ai-preview-section">
              <div className="rounded-2xl bg-gradient-to-br from-royal to-royal-dark p-4 text-white shadow-soft">
                <div className="flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/15">
                    <Sparkles className="h-4 w-4 text-amber-300" />
                  </span>
                  <h3 className="font-display text-sm font-extrabold tracking-tight">AI Match Preview</h3>
                  <span className="ml-auto rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-100">
                    {preview?.source === "ai" ? "Gemini" : previewLoading ? "…" : "AI"}
                  </span>
                </div>

                {previewLoading && (
                  <div className="mt-3 flex items-center gap-2 text-xs font-medium text-rose-100" data-testid="ai-preview-loading">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analysing the matchup…
                  </div>
                )}

                {!previewLoading && preview && (
                  <div data-testid="ai-preview-content">
                    <p className="mt-2.5 text-sm leading-relaxed text-rose-50" data-testid="ai-preview-text">
                      {preview.preview}
                    </p>
                    <div className="mt-3 flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2">
                      <TrendingUp className="h-4 w-4 shrink-0 text-amber-300" />
                      <span className="text-xs font-semibold text-white" data-testid="ai-preview-prediction">
                        {preview.favorite} favoured · {preview.win_prob}% · {preview.prediction}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/15">
                      <motion.div
                        className="h-full rounded-full bg-amber-300"
                        initial={{ width: 0 }}
                        animate={{ width: `${preview.win_prob}%` }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                      />
                    </div>
                  </div>
                )}

                {!previewLoading && !preview && (
                  <p className="mt-3 text-xs font-medium text-rose-100" data-testid="ai-preview-unavailable">
                    Preview unavailable right now.
                  </p>
                )}
              </div>
            </div>

            {/* Match info (real, no simulated commentary) */}
            <div className="flex-1 overflow-y-auto px-5 py-4" data-testid="match-info">
              <h3 className="font-display text-base font-bold text-slate-900">Match info</h3>
              <div className="mt-3 space-y-2.5">
                <InfoRow icon={Trophy} label="Format" value={match.sport} />
                <InfoRow icon={CalendarClock} label="Start" value={startLabel || "TBC"} />
                <InfoRow icon={Clock} label="Status" value={match.status || (match.live ? "Live" : (hasScores ? "Finished" : "Scheduled"))} />
              </div>
              <p className="mt-4 text-xs leading-relaxed text-slate-400">
                Live ball-by-ball commentary appears here once a match is in progress.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const InfoRow = ({ icon: Icon, label, value }) => (
  <div className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-soft">
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-royal-light text-royal">
      <Icon className="h-4 w-4" />
    </span>
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="truncate text-sm font-bold text-slate-800">{value}</p>
    </div>
  </div>
);
