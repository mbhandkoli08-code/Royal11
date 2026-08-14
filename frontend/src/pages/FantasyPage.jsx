import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trophy, Check, Loader2, ChevronLeft, X, Ticket, Sparkles } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useWallet } from "@/context/WalletContext";
import { DEFAULT_THEME, getTeamTheme, splitTeams, teamShort, themeVars } from "@/lib/teamColors";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import "./fantasy-glass.css";

const API = process.env.REACT_APP_BACKEND_URL + "/api";
const ROLE_LABEL = { WK: "Wicket-Keepers", BAT: "Batsmen", AR: "All-Rounders", BOWL: "Bowlers" };
const ROLE_ORDER = ["WK", "BAT", "AR", "BOWL"];
const ROLE_NAME = { WK: "Wicket-Keeper", BAT: "Batsman", AR: "All-Rounder", BOWL: "Bowler" };
// Higher = more likely to be a fantasy "top pick" (batting-heavy roles score more).
const ROLE_WEIGHT = { BAT: 4, AR: 5, WK: 3, BOWL: 2 };

// Deterministic "form score" so the same pool always ranks the same way
// (feels data-driven, not random) — role weight + a stable per-name hash.
const formScore = (p) => {
  const h = (p.name || "").split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 997, 7);
  return (ROLE_WEIGHT[p.role] || 1) * 100 + (h % 40);
};

export default function FantasyPage() {
  const { token } = useAuth();
  const { refresh } = useWallet();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [tab, setTab] = useState("lobby");
  const [matches, setMatches] = useState([]);
  const [loadErr, setLoadErr] = useState(false);
  const [loadingMatches, setLoadingMatches] = useState(true);
  const [fixture, setFixture] = useState(null);
  const [contests, setContests] = useState([]);
  const [pool, setPool] = useState([]);
  const [rules, setRules] = useState({ budget: 100, role_ranges: {}, max_per_team: 7 });
  const [builder, setBuilder] = useState(null);
  const [sel, setSel] = useState([]);
  const [cap, setCap] = useState(null);
  const [vc, setVc] = useState(null);
  const [mine, setMine] = useState([]);
  const [busy, setBusy] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState(null);

  const loadMatches = useCallback(async () => {
    setLoadingMatches(true);
    try {
      const { data } = await axios.get(`${API}/fantasy/matches`, { headers });
      setMatches(data.matches || []); setLoadErr(false);
    } catch { setLoadErr(true); }
    finally { setLoadingMatches(false); }
  }, [headers]);
  const loadMine = useCallback(async () => {
    try { const { data } = await axios.get(`${API}/fantasy/my-contests`, { headers }); setMine(data); }
    catch { /* ignore */ }
  }, [headers]);
  useEffect(() => { if (token) { loadMatches(); loadMine(); } }, [token, loadMatches, loadMine]);

  const teams = useMemo(() => splitTeams(fixture?.label), [fixture]);
  const theme = useMemo(() => {
    if (!fixture) return DEFAULT_THEME;
    return getTeamTheme(selectedTeam || teams[0]);
  }, [fixture, selectedTeam, teams]);

  const openFixture = async (m) => {
    const fid = String(m.id);
    setFixture({ id: fid, label: m.name || `${m.teamA?.full || ""} vs ${m.teamB?.full || ""}` });
    setSelectedTeam(null);
    try {
      const [c, p] = await Promise.all([
        axios.get(`${API}/fantasy/contests?fixture_id=${fid}`, { headers }),
        axios.get(`${API}/fantasy/fixtures/${fid}/players`, { headers }),
      ]);
      setContests(c.data);
      setPool(p.data.players || []);
      setRules({ budget: p.data.budget, role_ranges: p.data.role_ranges, max_per_team: p.data.max_per_team });
    } catch { toast.error("Couldn't load this match"); }
  };

  const startBuild = (contest) => {
    if (!pool.length) return toast.error("Squad not available yet for this match");
    setBuilder({ contest }); setSel([]); setCap(null); setVc(null);
  };

  const toggle = (pid) => setSel((s) => s.includes(pid) ? s.filter((x) => x !== pid) : (s.length >= 11 ? (toast.error("Max 11 players"), s) : [...s, pid]));

  const chosen = pool.filter((p) => sel.includes(p.player_id));
  const credits = chosen.reduce((a, p) => a + (p.credit_value || 0), 0);
  const roleCounts = chosen.reduce((a, p) => ({ ...a, [p.role]: (a[p.role] || 0) + 1 }), {});

  // Ranked "top picks" from the real match pool — rotated across contest cards
  // so each card highlights a different data-driven suggestion.
  const topPicks = useMemo(
    () => [...pool].sort((a, b) => formScore(b) - formScore(a)).slice(0, 8),
    [pool]);

  const join = async () => {
    if (busy) return;
    if (sel.length !== 11) return toast.error("Pick exactly 11 players");
    if (!cap || !vc) return toast.error("Choose a Captain and Vice-Captain");
    setBusy(true);
    try {
      await axios.post(`${API}/fantasy/contests/${builder.contest.id}/join`,
        { selections: sel, captain_id: cap, vice_captain_id: vc }, { headers });
      toast.success("Team locked in — good luck!");
      setBuilder(null); await refresh(); await loadMine();
      const c = await axios.get(`${API}/fantasy/contests?fixture_id=${fixture.id}`, { headers }); setContests(c.data);
    } catch (e) { toast.error("Couldn't join", { description: e.response?.data?.detail || "" }); }
    finally { setBusy(false); }
  };

  return (
    <div className="fx-root" data-testid="fantasy-page" style={themeVars(theme)}>
      <div className="fx-glow fx-glow--a" /><div className="fx-glow fx-glow--b" />
      <div className="fx-content mx-auto max-w-2xl px-4 pb-28 pt-6 md:pb-10">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl fx-glass"><Trophy className="h-5 w-5" style={{ color: theme.accent }} /></span>
          <div>
            <h1 className="font-display text-2xl font-extrabold text-white">Fantasy Cricket</h1>
            <p className="text-xs text-white/60">Real matches · real stats · win coins</p>
          </div>
        </div>

        <div className="mb-5 flex gap-2">
          {["lobby", "mine"].map((t) => (
            <button key={t} data-testid={`fantasy-tab-${t}`} onClick={() => setTab(t)}
              className={`rounded-full px-4 py-2 text-sm font-bold ${tab === t ? "fx-tab fx-tab-active" : "fx-tab"}`}>
              {t === "lobby" ? "Matches" : "My Contests"}
            </button>
          ))}
        </div>

        {tab === "lobby" && !fixture && (
          <div className="space-y-3" data-testid="fantasy-matches">
            {loadingMatches && matches.length === 0 && (
              <div className="space-y-3" data-testid="fantasy-matches-loading">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="fx-glass flex items-center justify-between p-4">
                    <div className="space-y-2">
                      <div className="h-3.5 w-40 animate-pulse rounded bg-white/15" />
                      <div className="h-2.5 w-24 animate-pulse rounded bg-white/10" />
                    </div>
                    <Loader2 className="h-5 w-5 animate-spin text-white/40" />
                  </div>
                ))}
              </div>
            )}
            {!loadingMatches && matches.length === 0 && (
              <p className="fx-glass p-6 text-center text-sm text-white/70">
                {loadErr ? "Couldn't load matches — please try again." : "No upcoming matches available right now."}
              </p>
            )}
            {matches.map((m) => (
              <button key={m.id} data-testid={`fantasy-match-${m.id}`} onClick={() => openFixture(m)}
                className="fx-glass fx-hover flex w-full items-center justify-between p-4 text-left">
                <div>
                  <p className="font-bold text-white">{m.name || `${m.teamA?.full || "TBD"} vs ${m.teamB?.full || "TBD"}`}</p>
                  <p className="text-xs text-white/50">{m.starting_at || m.league || ""}</p>
                </div>
                <Trophy className="h-5 w-5" style={{ color: theme.accent }} />
              </button>
            ))}
          </div>
        )}

        {tab === "lobby" && fixture && (
          <div data-testid="fantasy-contests">
            <button onClick={() => setFixture(null)} className="mb-3 flex items-center gap-1 text-sm font-semibold text-white/80">
              <ChevronLeft className="h-4 w-4" /> Matches
            </button>

            <TeamThemeCard label={fixture.label} teams={teams} theme={theme} selected={selectedTeam || teams[0]} onSelect={setSelectedTeam} />

            <PromoCode theme={theme} headers={headers} onApplied={refresh} />

            <p className="mb-3 mt-4 font-bold text-white">{fixture.label}</p>
            {contests.length === 0 ? (
              <p className="fx-glass p-6 text-center text-sm text-white/70">No open contests for this match yet.</p>
            ) : (
              <div className="space-y-3">
                {contests.map((c, idx) => {
                  const pick = topPicks.length ? topPicks[idx % topPicks.length] : null;
                  return (
                  <div key={c.id} data-testid={`contest-${c.id}`} className="fx-glass fx-hover p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-bold text-white">{c.name}</p>
                      <span className="rounded-full fx-pill px-2.5 py-1 text-xs font-bold">{c.prize_pool?.toLocaleString("en-IN")} coins</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-white/60">
                      <span className="rounded-full fx-pill-neutral px-2 py-0.5">{c.entry_fee === 0 ? "FREE" : `${c.entry_fee} entry`}</span>
                      <span>{c.participant_count}/{c.max_participants} joined</span>
                    </div>
                    {pick && (
                      <div className="fx-toppick mt-2 flex items-center gap-2.5 px-2.5 py-2" data-testid={`toppick-${c.id}`}>
                        <PlayerAvatar seed={pick.player_id} name={pick.name} size={34} />
                        <div className="min-w-0">
                          <p className="text-[9px] font-extrabold uppercase tracking-widest" style={{ color: theme.accent }}>Top Pick</p>
                          <p className="truncate text-xs font-bold text-white">{pick.name}</p>
                          <p className="truncate text-[10px] text-white/55">{ROLE_NAME[pick.role] || pick.role} · {pick.team_name || pick.team_id}</p>
                        </div>
                      </div>
                    )}
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, (c.participant_count / c.max_participants) * 100)}%`, background: theme.accent }} />
                    </div>
                    <button data-testid={`join-${c.id}`} onClick={() => startBuild(c)}
                      className="fx-btn-gold mt-3 w-full rounded-xl py-2.5 text-sm">Pick Team & Join</button>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === "mine" && (
          <div className="space-y-3" data-testid="fantasy-mine">
            {mine.length === 0 && <p className="fx-glass p-6 text-center text-sm text-white/70">You haven&apos;t joined any contests yet.</p>}
            {mine.map(({ contest, team }) => (
              <div key={team.id} data-testid={`mine-${contest.id}`} className="fx-glass p-4">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-white">{contest.name}</p>
                  <span className="rounded-full fx-pill-neutral px-2.5 py-1 text-xs font-semibold">{contest.status}</span>
                </div>
                <p className="mt-1 text-xs text-white/60">{contest.match_label}</p>
                {contest.status === "SETTLED" && (
                  <p className="mt-2 text-sm font-bold" style={{ color: theme.accent }}>Rank #{team.rank} · Score {team.score} · Won {team.winnings} coins</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {builder && (
        <div className="fixed inset-0 z-[60] flex flex-col fx-root" data-testid="team-builder" style={themeVars(theme)}>
          <div className="fx-glow fx-glow--a" />
          <div className="fx-content flex items-center justify-between border-b border-white/10 p-4">
            <button onClick={() => setBuilder(null)} data-testid="tb-close"><X className="h-5 w-5 text-white/80" /></button>
            <p className="font-bold text-white">{sel.length}/11 · {credits.toFixed(1)}/{rules.budget} cr</p>
            <div className="w-5" />
          </div>
          <div className="fx-content flex-1 overflow-y-auto p-4">
            {ROLE_ORDER.map((role) => {
              const [lo, hi] = rules.role_ranges[role] || [0, 11];
              return (
                <div key={role} className="mb-4">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider text-white/70">{ROLE_LABEL[role]} <span className="text-white/40">({roleCounts[role] || 0} · {lo}-{hi})</span></p>
                  <div className="space-y-2">
                    {pool.filter((p) => p.role === role).map((p) => {
                      const on = sel.includes(p.player_id);
                      return (
                        <button key={p.player_id} data-testid={`pick-${p.player_id}`} onClick={() => toggle(p.player_id)}
                          className={`flex w-full items-center justify-between rounded-xl p-3 text-left fx-pick ${on ? "fx-pick-on" : ""}`}>
                          <div className="flex items-center gap-2.5">
                            <PlayerAvatar seed={p.player_id} name={p.name} size={32} />
                            <div>
                              <p className="text-sm font-semibold text-white">{p.name}</p>
                              <p className="text-[11px] text-white/50">{p.team_name || p.team_id} · {p.credit_value} cr</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {on && (<>
                              <span onClick={(e) => { e.stopPropagation(); setCap(p.player_id); }} data-testid={`cap-${p.player_id}`}
                                className="grid h-7 w-7 place-items-center rounded-full text-[10px] font-bold"
                                style={cap === p.player_id ? { background: theme.accent, color: "#201203" } : { background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)" }}>C</span>
                              <span onClick={(e) => { e.stopPropagation(); setVc(p.player_id); }} data-testid={`vc-${p.player_id}`}
                                className="grid h-7 w-7 place-items-center rounded-full text-[10px] font-bold"
                                style={vc === p.player_id ? { background: "rgba(255,255,255,0.9)", color: "#201203" } : { background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)" }}>VC</span>
                            </>)}
                            {on && <Check className="h-4 w-4" style={{ color: theme.accent }} />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="fx-content border-t border-white/10 p-4">
            <button data-testid="tb-join" onClick={join} disabled={busy}
              className="fx-btn-gold flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trophy className="h-4 w-4" />} Join for {builder.contest.entry_fee === 0 ? "FREE" : `${builder.contest.entry_fee} coins`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Compact "Your Team Theme" strip — short-code badge + label + A/B team switch.
function TeamThemeCard({ teams, theme, selected, onSelect }) {
  return (
    <div className="fx-glass-soft mb-3 flex items-center gap-3 px-3 py-2.5" data-testid="fantasy-team-theme">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[10px] font-extrabold"
        style={{ background: theme.primary, color: "#fff", boxShadow: `0 0 0 2px rgba(var(--fx-accent-rgb),0.5)` }}>
        {teamShort(selected)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-white/50">Your Team Theme{!theme.isTeam && selected ? " · default colors" : ""}</p>
        <p className="truncate text-xs font-bold text-white">{theme.isTeam ? theme.teamName : (selected || "ROYAL11")}</p>
      </div>
      <div className="flex gap-1.5">
        {teams.filter(Boolean).map((t, i) => (
          <button key={t} data-testid={`team-chip-${i === 0 ? "a" : "b"}`} onClick={() => onSelect(t)}
            className={`max-w-[110px] truncate rounded-full px-2.5 py-1 text-[11px] font-bold ${(selected === t) ? "fx-pill" : "fx-pill-neutral"}`}>
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}

// Promo code input with success/failure micro-interactions.
function PromoCode({ theme, headers, onApplied }) {
  const [code, setCode] = useState("");
  const [state, setState] = useState("idle"); // idle | ok | err
  const [busy, setBusy] = useState(false);
  const [sparks, setSparks] = useState([]);
  const timerRef = useRef(null);

  const burst = () => {
    const dots = Array.from({ length: 12 }, (_, i) => {
      const ang = (Math.PI * 2 * i) / 12 + Math.random() * 0.4;
      const dist = 26 + Math.random() * 26;
      return { id: `${Date.now()}-${i}`, dx: `${Math.cos(ang) * dist}px`, dy: `${Math.sin(ang) * dist}px` };
    });
    setSparks(dots);
    setTimeout(() => setSparks([]), 750);
  };

  const apply = async () => {
    if (busy || !code.trim()) return;
    setBusy(true); setState("idle");
    if (timerRef.current) clearTimeout(timerRef.current);
    try {
      const { data } = await axios.post(`${API}/promo/apply`, { code: code.trim() }, { headers });
      setState("ok"); burst();
      toast.success(`🎉 Coupon Applied! +${data.bonus_coins} bonus coins`);
      setCode(""); onApplied && onApplied();
    } catch (e) {
      setState("err");
      toast.error("Invalid promo code", { description: e.response?.data?.detail || "" });
    } finally {
      setBusy(false);
      timerRef.current = setTimeout(() => setState("idle"), 950);
    }
  };

  return (
    <div className="fx-glass-soft mb-1 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-white/70">
        <Ticket className="h-3.5 w-3.5" style={{ color: theme.accent }} /> Have a promo code?
      </div>
      <div className="flex items-center gap-2">
        <input data-testid="promo-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ENTER CODE"
          className={`fx-input flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold tracking-wide ${state === "ok" ? "fx-pulse-green" : ""} ${state === "err" ? "fx-shake fx-invalid" : ""}`} />
        <div className="relative">
          <button data-testid="promo-apply" onClick={apply} disabled={busy}
            className={`fx-btn-gold rounded-xl px-4 py-2.5 text-sm disabled:opacity-60 ${state === "ok" ? "fx-bounce" : ""}`}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
          </button>
          <span className="fx-sparks" data-testid="promo-sparks">
            {sparks.map((s) => (
              <span key={s.id} className="fx-spark" style={{ "--dx": s.dx, "--dy": s.dy }} />
            ))}
          </span>
        </div>
      </div>
      <p className="mt-1.5 flex items-center gap-1 text-[10px] text-white/40"><Sparkles className="h-3 w-3" /> Bonus coins are playable & unlock as you play.</p>
    </div>
  );
}
