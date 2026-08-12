import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Trophy, Users, Coins, Check, Crown, Star, Loader2, ChevronLeft, X } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useWallet } from "@/context/WalletContext";

const API = process.env.REACT_APP_BACKEND_URL + "/api";
const ROLE_LABEL = { WK: "Wicket-Keepers", BAT: "Batsmen", AR: "All-Rounders", BOWL: "Bowlers" };
const ROLE_ORDER = ["WK", "BAT", "AR", "BOWL"];

export default function FantasyPage() {
  const { token } = useAuth();
  const { refresh } = useWallet();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [tab, setTab] = useState("lobby");
  const [matches, setMatches] = useState([]);
  const [fixture, setFixture] = useState(null);
  const [contests, setContests] = useState([]);
  const [pool, setPool] = useState([]);
  const [rules, setRules] = useState({ budget: 100, role_ranges: {}, max_per_team: 7 });
  const [builder, setBuilder] = useState(null); // {contest}
  const [sel, setSel] = useState([]);
  const [cap, setCap] = useState(null);
  const [vc, setVc] = useState(null);
  const [mine, setMine] = useState([]);
  const [busy, setBusy] = useState(false);

  const loadMatches = useCallback(async () => {
    try { const { data } = await axios.get(`${API}/fantasy/matches`, { headers }); setMatches(data.matches || []); }
    catch { /* ignore */ }
  }, [headers]);
  const loadMine = useCallback(async () => {
    try { const { data } = await axios.get(`${API}/fantasy/my-contests`, { headers }); setMine(data); }
    catch { /* ignore */ }
  }, [headers]);
  useEffect(() => { loadMatches(); loadMine(); }, [loadMatches, loadMine]);

  const openFixture = async (m) => {
    const fid = String(m.id);
    setFixture({ id: fid, label: m.name || `${m.localteam?.name || ""} vs ${m.visitorteam?.name || ""}` });
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
  const teamCounts = chosen.reduce((a, p) => ({ ...a, [p.team_id]: (a[p.team_id] || 0) + 1 }), {});

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
    <div className="mx-auto max-w-lg px-4 pb-24 pt-6" data-testid="fantasy-page">
      <div className="mb-5 flex items-center gap-2">
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-royal text-white"><Trophy className="h-5 w-5" /></span>
        <div><h1 className="font-display text-2xl font-extrabold text-slate-900">Fantasy Cricket</h1>
          <p className="text-xs text-slate-400">Real matches · real stats · win coins</p></div>
      </div>

      <div className="mb-5 flex gap-2">
        {["lobby", "mine"].map((t) => (
          <button key={t} data-testid={`fantasy-tab-${t}`} onClick={() => setTab(t)}
            className={`rounded-full px-4 py-2 text-sm font-bold transition-colors ${tab === t ? "bg-royal text-white" : "bg-white text-slate-500"}`}>
            {t === "lobby" ? "Matches" : "My Contests"}
          </button>
        ))}
      </div>

      {tab === "lobby" && !fixture && (
        <div className="space-y-3" data-testid="fantasy-matches">
          {matches.length === 0 && <p className="rounded-2xl bg-white p-6 text-center text-sm text-slate-400">No upcoming matches available right now.</p>}
          {matches.map((m) => (
            <button key={m.id} data-testid={`fantasy-match-${m.id}`} onClick={() => openFixture(m)}
              className="flex w-full items-center justify-between rounded-2xl bg-white p-4 text-left shadow-soft transition-transform hover:scale-[1.01]">
              <div><p className="font-bold text-slate-900">{m.name || `${m.localteam?.name || "TBD"} vs ${m.visitorteam?.name || "TBD"}`}</p>
                <p className="text-xs text-slate-400">{m.starting_at || m.round || ""}</p></div>
              <Trophy className="h-5 w-5 text-royal" />
            </button>
          ))}
        </div>
      )}

      {tab === "lobby" && fixture && (
        <div data-testid="fantasy-contests">
          <button onClick={() => setFixture(null)} className="mb-3 flex items-center gap-1 text-sm font-semibold text-royal"><ChevronLeft className="h-4 w-4" /> Matches</button>
          <p className="mb-3 font-bold text-slate-900">{fixture.label}</p>
          {contests.length === 0 ? <p className="rounded-2xl bg-white p-6 text-center text-sm text-slate-400">No open contests for this match yet.</p> : (
            <div className="space-y-3">
              {contests.map((c) => (
                <div key={c.id} data-testid={`contest-${c.id}`} className="rounded-2xl bg-white p-4 shadow-soft">
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-slate-900">{c.name}</p>
                    <span className="rounded-full bg-royal-light px-2.5 py-1 text-xs font-bold text-royal">{c.prize_pool?.toLocaleString("en-IN")} coins</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">Entry {c.entry_fee} coins · {c.participant_count}/{c.max_participants} joined</p>
                  <button data-testid={`join-${c.id}`} onClick={() => startBuild(c)} className="mt-3 w-full rounded-xl bg-royal py-2.5 text-sm font-bold text-white">Pick Team & Join</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "mine" && (
        <div className="space-y-3" data-testid="fantasy-mine">
          {mine.length === 0 && <p className="rounded-2xl bg-white p-6 text-center text-sm text-slate-400">You haven't joined any contests yet.</p>}
          {mine.map(({ contest, team }) => (
            <div key={team.id} data-testid={`mine-${contest.id}`} className="rounded-2xl bg-white p-4 shadow-soft">
              <div className="flex items-center justify-between">
                <p className="font-bold text-slate-900">{contest.name}</p>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{contest.status}</span>
              </div>
              <p className="mt-1 text-xs text-slate-400">{contest.match_label}</p>
              {contest.status === "SETTLED" && (
                <p className="mt-2 text-sm font-bold text-emerald-600">Rank #{team.rank} · Score {team.score} · Won {team.winnings} coins</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Team builder */}
      {builder && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white" data-testid="team-builder">
          <div className="flex items-center justify-between border-b border-slate-100 p-4">
            <button onClick={() => setBuilder(null)} data-testid="tb-close"><X className="h-5 w-5 text-slate-500" /></button>
            <p className="font-bold text-slate-900">{sel.length}/11 · {credits.toFixed(1)}/{rules.budget} cr</p>
            <div className="w-5" />
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {ROLE_ORDER.map((role) => {
              const [lo, hi] = rules.role_ranges[role] || [0, 11];
              return (
                <div key={role} className="mb-4">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">{ROLE_LABEL[role]} <span className="text-slate-300">({roleCounts[role] || 0} · {lo}-{hi})</span></p>
                  <div className="space-y-2">
                    {pool.filter((p) => p.role === role).map((p) => {
                      const on = sel.includes(p.player_id);
                      return (
                        <button key={p.player_id} data-testid={`pick-${p.player_id}`} onClick={() => toggle(p.player_id)}
                          className={`flex w-full items-center justify-between rounded-xl border-2 p-3 text-left transition-colors ${on ? "border-royal bg-royal-light" : "border-slate-100 bg-white"}`}>
                          <div><p className="text-sm font-semibold text-slate-900">{p.name}</p>
                            <p className="text-[11px] text-slate-400">{p.team_name || p.team_id} · {p.credit_value} cr</p></div>
                          <div className="flex items-center gap-2">
                            {on && (<>
                              <span onClick={(e) => { e.stopPropagation(); setCap(p.player_id); }} data-testid={`cap-${p.player_id}`} className={`grid h-7 w-7 place-items-center rounded-full text-[10px] font-bold ${cap === p.player_id ? "bg-amber-400 text-white" : "bg-slate-100 text-slate-500"}`}>C</span>
                              <span onClick={(e) => { e.stopPropagation(); setVc(p.player_id); }} data-testid={`vc-${p.player_id}`} className={`grid h-7 w-7 place-items-center rounded-full text-[10px] font-bold ${vc === p.player_id ? "bg-sky-400 text-white" : "bg-slate-100 text-slate-500"}`}>VC</span>
                            </>)}
                            {on && <Check className="h-4 w-4 text-royal" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="border-t border-slate-100 p-4">
            <button data-testid="tb-join" onClick={join} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-royal py-3.5 font-bold text-white disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trophy className="h-4 w-4" />} Join for {builder.contest.entry_fee} coins
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
