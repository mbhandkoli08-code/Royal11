import { useState, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Check, Plus, Users, Coins, Lock, Sparkles, Loader2, Heart } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";
import { useWallet } from "@/context/WalletContext";
import { CONTEST, PLAYERS } from "@/lib/data";
import { IPL_TEAMS, readableText, hexToRgb, useFavoriteTeam } from "@/lib/iplTeams";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const ROLES = [
  { key: "WK", label: "Wicket-Keepers" },
  { key: "BAT", label: "Batters" },
  { key: "AR", label: "All-Rounders" },
  { key: "BOWL", label: "Bowlers" },
];
const MAX = 11;

export const TeamBuilder = ({ open, onClose, onLock }) => {
  const { joinContest } = useWallet();
  const { team, setFavorite } = useFavoriteTeam();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picked, setPicked] = useState([]);
  const [captain, setCaptain] = useState(null);
  const [vice, setVice] = useState(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachTip, setCoachTip] = useState(null);

  // First run (no favorite yet) => show the picker; otherwise reflect the team.
  const showPicker = pickerOpen || !team;
  const accent = team?.primary || "#C8102E"; // fallback = app cherry red
  const accent2 = team?.secondary || "#8A0F22";
  const onAccent = readableText(accent);
  const accentRgb = hexToRgb(accent);

  const choose = (id) => {
    setFavorite(id);
    setPickerOpen(false);
  };

  const askCoach = async () => {
    if (coachLoading) return;
    setCoachLoading(true);
    setCoachTip(null);
    try {
      const { data } = await axios.post(`${API}/fantasy/coach`, {
        players: PLAYERS,
        budget: CONTEST.budget,
        size: MAX,
      }, { timeout: 45000 });
      setPicked(data.xi);
      setCaptain(data.captain);
      setVice(data.vice);
      setCoachTip(data.rationale);
      toast.success("AI Coach picked your XI ✨", { description: "Captain & Vice-Captain set. Review and lock." });
    } catch (e) {
      toast.error("AI Coach unavailable", { description: "Please try again in a moment." });
    } finally {
      setCoachLoading(false);
    }
  };

  const creditsUsed = useMemo(
    () => picked.reduce((s, id) => s + (PLAYERS.find((p) => p.id === id)?.credits || 0), 0),
    [picked]
  );
  const budgetLeft = +(CONTEST.budget - creditsUsed).toFixed(1);

  const toggle = (p) => {
    setPicked((prev) => {
      if (prev.includes(p.id)) {
        if (captain === p.id) setCaptain(null);
        if (vice === p.id) setVice(null);
        return prev.filter((x) => x !== p.id);
      }
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

  const chooseCaptain = (id) => {
    setCaptain((c) => (c === id ? null : id));
    setVice((v) => (v === id ? null : v));
  };
  const chooseVice = (id) => {
    setVice((v) => (v === id ? null : id));
    setCaptain((c) => (c === id ? null : c));
  };

  const canLock = picked.length === MAX && captain && vice;

  const lock = async () => {
    if (!canLock) return;
    // Joining the contest debits the entry fee via the real wallet ledger.
    const ok = await joinContest("ipl_grand_league");
    if (ok) onClose?.();
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
            {showPicker ? (
              <div className="flex flex-col" data-testid="team-picker">
                <div className="flex items-start justify-between border-b border-slate-100 bg-white p-5">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-flame">Personalize</p>
                    <h2 className="font-display text-xl font-extrabold tracking-tight text-slate-900">Choose your team</h2>
                    <p className="mt-1 text-xs text-slate-500">Pick your favourite IPL side to theme your Fantasy screen.</p>
                  </div>
                  {team && (
                    <button
                      data-testid="team-picker-close"
                      onClick={() => setPickerOpen(false)}
                      className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-600 transition-colors hover:bg-slate-200"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 overflow-y-auto p-5 sm:grid-cols-3" style={{ maxHeight: "72vh" }}>
                  {IPL_TEAMS.map((t) => {
                    const selected = team?.id === t.id;
                    return (
                      <button
                        key={t.id}
                        data-testid={`team-option-${t.id}`}
                        onClick={() => choose(t.id)}
                        className="group relative flex flex-col items-center gap-2 rounded-2xl border-2 bg-white p-4 text-center transition-transform hover:-translate-y-0.5"
                        style={{ borderColor: selected ? t.primary : "rgba(15,23,42,0.06)" }}
                      >
                        <span
                          className="grid h-14 w-14 place-items-center rounded-2xl text-sm font-extrabold shadow-soft"
                          style={{ background: `linear-gradient(135deg, ${t.primary}, ${t.secondary})`, color: readableText(t.primary) }}
                        >
                          {t.short}
                        </span>
                        <span className="text-xs font-bold leading-tight text-slate-800">{t.name}</span>
                        {selected && (
                          <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full text-white" style={{ background: t.primary }}>
                            <Heart className="h-3.5 w-3.5" fill="currentColor" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
            <>
            {/* Header */}
            <div className="flex items-start justify-between p-5" style={{ background: `linear-gradient(135deg, ${accent}, ${accent2})` }}>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: onAccent, opacity: 0.8 }}>{CONTEST.sub}</p>
                <h2 className="font-display text-xl font-extrabold tracking-tight" style={{ color: onAccent }}>Build Your XI</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  data-testid="change-team-btn"
                  onClick={() => setPickerOpen(true)}
                  title={`Favourite: ${team.name} — tap to change`}
                  className="grid h-9 w-9 place-items-center rounded-xl text-[11px] font-extrabold transition-transform hover:-translate-y-0.5"
                  style={{ background: onAccent, color: accent }}
                >
                  {team.short}
                </button>
                <button
                  data-testid="ai-coach-btn"
                  onClick={askCoach}
                  disabled={coachLoading}
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-transform ${coachLoading ? "cursor-wait" : "hover:-translate-y-0.5"}`}
                  style={{ background: "rgba(255,255,255,0.22)", color: onAccent }}
                >
                  {coachLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {coachLoading ? "Thinking…" : "AI Coach"}
                </button>
                <button
                  data-testid="team-builder-close"
                  onClick={onClose}
                  className="grid h-9 w-9 place-items-center rounded-xl transition-colors"
                  style={{ background: "rgba(255,255,255,0.22)", color: onAccent }}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Slogan banner */}
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-2.5" style={{ background: `rgba(${accentRgb}, 0.10)` }} data-testid="team-slogan">
              <Heart className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} fill="currentColor" />
              <p className="text-xs font-semibold leading-tight" style={{ color: accent }}>
                {`You're building your team, ${team.name} style — "${team.slogan}"`}
              </p>
            </div>

            {coachTip && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                data-testid="coach-tip"
                className="flex items-start gap-2 border-b border-slate-100 bg-royal-light px-5 py-3 text-xs font-medium leading-relaxed text-royal"
              >
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0" /> {coachTip}
              </motion.div>
            )}

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
                            isPicked ? "" : "border-slate-100 bg-white"
                          }`}
                          style={isPicked ? { borderColor: accent, background: `rgba(${accentRgb}, 0.08)` } : undefined}
                        >
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-900 text-xs font-bold text-white">
                            {p.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-slate-900">{p.name}</p>
                            <p className="text-xs text-slate-500">{p.team} · {p.points} pts</p>
                          </div>
                          <span className="text-sm font-bold text-slate-700">{p.credits}<span className="text-xs text-slate-400"> cr</span></span>
                          {isPicked && (
                            <div className="flex gap-1">
                              <button
                                data-testid={`captain-${p.id}`}
                                onClick={() => chooseCaptain(p.id)}
                                className={`h-9 w-9 shrink-0 rounded-xl text-[11px] font-extrabold transition-transform hover:scale-105 ${
                                  captain === p.id ? "bg-flame text-white" : "bg-slate-100 text-slate-500"
                                }`}
                              >
                                C
                              </button>
                              <button
                                data-testid={`vice-${p.id}`}
                                onClick={() => chooseVice(p.id)}
                                className={`h-9 w-9 shrink-0 rounded-xl text-[11px] font-extrabold transition-transform hover:scale-105 ${
                                  vice === p.id ? "bg-royal text-white" : "bg-slate-100 text-slate-500"
                                }`}
                              >
                                VC
                              </button>
                            </div>
                          )}
                          <button
                            data-testid={`player-toggle-${p.id}`}
                            onClick={() => toggle(p)}
                            disabled={disabled}
                            className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-transform hover:scale-105 ${
                              isPicked
                                ? "text-white"
                                : disabled
                                ? "cursor-not-allowed bg-slate-100 text-slate-300"
                                : "bg-mint text-white"
                            }`}
                            style={isPicked ? { background: accent, color: onAccent } : undefined}
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
                  canLock ? "hover:-translate-y-0.5" : "cursor-not-allowed bg-slate-100 text-slate-400"
                }`}
                style={canLock ? { background: accent, color: onAccent } : undefined}
              >
                <Lock className="h-4 w-4" />
                {canLock
                  ? `Lock Lineup · −${CONTEST.entryFee} coins`
                  : picked.length < MAX
                  ? `Pick ${MAX - picked.length} more player${MAX - picked.length === 1 ? "" : "s"}`
                  : !captain
                  ? "Tap C to pick a Captain (2x)"
                  : "Tap VC to pick a Vice-Captain (1.5x)"}
              </button>
            </div>
            </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
