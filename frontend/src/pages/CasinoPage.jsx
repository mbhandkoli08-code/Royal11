import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { Spade, Users, Coins, Loader2, ShieldCheck, Plus, LogOut, Play, Check, X, Crown, Layers, Zap } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import RummyTable from "@/pages/RummyTable";
import { PlayingCard } from "@/components/PlayingCard";
import { PlayerAvatar } from "@/components/PlayerAvatar";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const GAMES = [
  { id: "high_card", label: "High Card", icon: Spade },
  { id: "rummy_points", label: "Rummy", icon: Layers },
];

export default function CasinoPage() {
  const { user, token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [tables, setTables] = useState([]);
  const [tableId, setTableId] = useState(() => localStorage.getItem("royal11_casino_table") || null);
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [verify, setVerify] = useState(null);
  const [practice, setPractice] = useState(false);
  const [game, setGame] = useState(() => localStorage.getItem("royal11_casino_game") || "high_card");
  const [meta, setMeta] = useState({ practiceBal: 0, prog: null });
  const pollRef = useRef(null);

  // Persist the current table + game so a page reload rehydrates the same round
  // (backend GET /state rebuilds it) instead of dumping the player to the lobby.
  useEffect(() => {
    if (tableId) { localStorage.setItem("royal11_casino_table", tableId); localStorage.setItem("royal11_casino_game", game); }
    else { localStorage.removeItem("royal11_casino_table"); localStorage.removeItem("royal11_casino_game"); }
  }, [tableId, game]);

  const loadMeta = useCallback(async () => {
    try {
      const [pb, pr] = await Promise.all([
        axios.get(`${API}/casino/practice/balance`, { headers }),
        axios.get(`${API}/casino/progression/me`, { headers }),
      ]);
      setMeta({ practiceBal: pb.data.balance, prog: pr.data });
    } catch { /* ignore */ }
  }, [token]);

  const loadLobby = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/casino/tables?game_type=${game}`, { headers });
      setTables(data);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [token, game]);

  const loadState = useCallback(async (id) => {
    try {
      const { data } = await axios.get(`${API}/casino/tables/${id}/state`, { headers });
      setState(data);
    } catch { /* ignore */ }
  }, [token]);

  useEffect(() => { loadLobby(); loadMeta(); }, [loadLobby, loadMeta]);

  // Keep the lobby fresh so tables that start a round drop their Join button.
  useEffect(() => {
    if (tableId) return undefined;
    const t = setInterval(loadLobby, 10000);
    return () => clearInterval(t);
  }, [tableId, loadLobby]);

  // Poll table state (~1.5s) while seated at a HIGH CARD table. Rummy tables
  // render <RummyTable/>, which does its own turn-aware polling.
  useEffect(() => {
    if (!tableId || game === "rummy_points") return undefined;
    loadState(tableId);
    pollRef.current = setInterval(() => loadState(tableId), 1500);
    return () => clearInterval(pollRef.current);
  }, [tableId, loadState, game]);

  const act = async (fn, ...args) => { setBusy(true); try { return await fn(...args); } finally { setBusy(false); } };

  const createTable = () => act(async () => {
    const cfg = game === "rummy_points" ? { point_value: 1 } : {};
    const { data } = await axios.post(`${API}/casino/tables`, { game_type: game, is_practice: practice, config: cfg }, { headers });
    await axios.post(`${API}/casino/tables/${data.id}/join`, {}, { headers });
    setTableId(data.id); setVerify(null);
  }).catch((e) => toast.error(e.response?.data?.detail || "Couldn't create table"));

  const quickPlay = () => act(async () => {
    const { data } = await axios.post(`${API}/casino/rummy/quick-match`, { point_value: 1, is_practice: practice }, { headers });
    setTableId(data.id); setVerify(null);
  }).catch((e) => toast.error(e.response?.data?.detail || "Couldn't find a table"));

  const joinTable = (id) => act(async () => {
    await axios.post(`${API}/casino/tables/${id}/join`, {}, { headers });
    setTableId(id); setVerify(null);
  }).catch((e) => {
    toast.error(e.response?.data?.detail || "Couldn't join — this table just started a round");
    loadLobby();  // refresh so a table that just filled/started drops its Join button
  });

  const leaveTable = () => act(async () => {
    await axios.post(`${API}/casino/tables/${tableId}/leave`, {}, { headers });
    setTableId(null); setState(null); setVerify(null); loadLobby();
  }).catch((e) => toast.error(e.response?.data?.detail || "Couldn't leave"));

  const startRound = () => act(async () => {
    const { data } = await axios.post(`${API}/casino/tables/${tableId}/start`, {}, { headers });
    setState(data); setVerify(null); loadMeta();
    if (data.round?.winner_user_id === user?.id) toast.success(`You won ${data.round.payout} ${data.round.is_practice ? "practice chips" : "coins"}!`);
  }).catch((e) => toast.error(e.response?.data?.detail || "Couldn't start round"));

  const runVerify = (rid) => act(async () => {
    const { data } = await axios.get(`${API}/casino/rounds/${rid}/verify`, { headers });
    setVerify(data);
  }).catch(() => toast.error("Verify failed"));

  const round = state?.round;
  const seated = state?.seats?.some((s) => s.user_id === user?.id);

  // Rummy tables get the full-screen turn-based table UI.
  if (tableId && game === "rummy_points") {
    return <RummyTable tableId={tableId} onLeave={() => { setTableId(null); setState(null); setVerify(null); loadLobby(); loadMeta(); }} />;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-28 pt-6" data-testid="casino-page">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-flame to-royal text-white"><Spade className="h-6 w-6" /></span>
        <div className="flex-1">
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-slate-900">Card Games</h1>
          <p className="text-xs font-medium text-slate-500">Provably fair · virtual coins · High Card (beta)</p>
        </div>
        {meta.prog && (
          <div className="text-right" data-testid="vip-badge">
            <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-400 to-yellow-600 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-white shadow-sm">
              <Crown className="h-3.5 w-3.5" /> {meta.prog.tier_label}
            </span>
            <div className="mt-1.5 h-1.5 w-28 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-yellow-600" style={{ width: `${meta.prog.progress_pct}%` }} data-testid="vip-xp-bar" />
            </div>
            <p className="mt-1 text-[10px] text-slate-400">{meta.prog.next_tier ? `${meta.prog.xp_to_next} XP to ${meta.prog.next_tier}` : "Max tier"}</p>
          </div>
        )}
      </header>

      {!tableId ? (
        /* ---------------- Lobby ---------------- */
        <div data-testid="casino-lobby">
          {/* Game selector */}
          <div className="mb-4 grid grid-cols-2 gap-2" data-testid="casino-game-toggle">
            {GAMES.map((g) => {
              const Icon = g.icon;
              const on = game === g.id;
              return (
                <button key={g.id} data-testid={`casino-game-${g.id}`} onClick={() => { setGame(g.id); setTables([]); }}
                  className={`flex items-center justify-center gap-2 rounded-2xl border py-3 text-sm font-bold transition-colors ${on ? "border-royal bg-royal-light text-royal" : "border-slate-200 bg-white text-slate-500"}`}>
                  <Icon className="h-4 w-4" /> {g.label}
                </button>
              );
            })}
          </div>
          {/* Cash / Practice toggle */}
          <div className="mb-4 flex items-center justify-between">
            <div className="inline-flex rounded-full bg-slate-100 p-1" data-testid="casino-mode-toggle">
              {[{ id: false, label: "Cash" }, { id: true, label: "Practice" }].map((m) => (
                <button key={String(m.id)} data-testid={`casino-mode-${m.label.toLowerCase()}`} onClick={() => setPractice(m.id)}
                  className={`rounded-full px-4 py-1.5 text-xs font-bold transition-colors ${practice === m.id ? "bg-white text-royal shadow-sm" : "text-slate-500"}`}>{m.label}</button>
              ))}
            </div>
            {practice && (
              <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700" data-testid="practice-balance">
                {meta.practiceBal.toLocaleString()} practice chips
              </span>
            )}
          </div>
          {practice && <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">Practice mode — free chips, no real coins, no payouts. Learn risk-free.</p>}
          {game === "rummy_points" && (
            <button data-testid="rummy-quick-play" onClick={quickPlay} disabled={busy}
              className="mb-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 to-yellow-600 py-4 text-sm font-black text-black shadow-lift transition-transform hover:-translate-y-0.5 disabled:opacity-70">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Quick Play
            </button>
          )}
          <button data-testid="casino-create-table" onClick={createTable} disabled={busy}
            className="mb-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-royal py-4 text-sm font-bold text-white shadow-lift transition-transform hover:-translate-y-0.5 disabled:opacity-70">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create {practice ? "Practice" : GAMES.find((g) => g.id === game).label} Table
          </button>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-royal" /></div>
          ) : tables.filter((t) => !!t.is_practice === practice).length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400" data-testid="casino-no-tables">No open {practice ? "practice" : "cash"} tables yet — create one to get started.</p>
          ) : (
            <div className="space-y-3">
              {tables.filter((t) => !!t.is_practice === practice).map((t) => {
                const joinable = t.status === "WAITING" && t.seat_count < t.max_players;
                return (
                <div key={t.id} data-testid={`casino-table-${t.id}`} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                  <div>
                    <p className="font-bold text-slate-900">{t.name}</p>
                    <p className="mt-0.5 flex items-center gap-3 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {t.seat_count}/{t.max_players}</span>
                      <span className="inline-flex items-center gap-1"><Coins className="h-3.5 w-3.5" /> {t.config.point_value != null ? `${t.config.point_value}/pt` : `${t.config.stake} entry`}</span>
                      {t.status === "RUNNING" && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">In progress</span>}
                    </p>
                  </div>
                  {joinable ? (
                    <button data-testid={`casino-join-${t.id}`} onClick={() => joinTable(t.id)} disabled={busy}
                      className="rounded-full bg-royal px-5 py-2.5 text-xs font-bold text-white transition-transform hover:-translate-y-0.5 disabled:opacity-70">Join</button>
                  ) : (
                    <span data-testid={`casino-table-status-${t.id}`}
                      className="rounded-full bg-slate-100 px-4 py-2.5 text-xs font-bold text-slate-400">
                      {t.status === "RUNNING" ? "In progress" : "Full"}
                    </span>
                  )}
                </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* ---------------- Table ---------------- */
        <div data-testid="casino-table-view">
          <div className="mb-4 flex items-center justify-between">
            <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
              {state?.name} · Round {state?.round_no}
              {(state?.is_practice || round?.is_practice) && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase text-amber-700" data-testid="practice-tag">Practice</span>}
            </p>
            <button data-testid="casino-leave" onClick={leaveTable} disabled={busy} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50"><LogOut className="h-3.5 w-3.5" /> Leave</button>
          </div>

          <div className="vegas-felt vegas-felt--red relative overflow-hidden p-5" style={{ minHeight: 340 }}>
            <div className="vegas-rail" />
            <div className="vegas-spotlight" />
            <div className="relative z-10 mb-3 flex items-center justify-between text-white/90">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200/90">Royal Table</span>
              {round?.pot != null && <span className="rounded-full bg-black/35 px-3 py-1 text-xs font-bold text-amber-200 ring-1 ring-amber-300/40">Pot {round.pot}</span>}
            </div>

            {/* Center dealer pile */}
            <div className="pointer-events-none absolute inset-x-0 top-[42%] z-10 flex -translate-y-1/2 flex-col items-center">
              <div className="flex">
                <PlayingCard faceDown size="md" />
                <div className="-ml-6"><PlayingCard faceDown size="md" /></div>
                <div className="-ml-6"><PlayingCard faceDown size="md" /></div>
              </div>
              <span className="mt-2 text-[10px] font-bold uppercase tracking-widest text-amber-200/70">Deck</span>
            </div>

            {/* Seats around the oval */}
            <div className="relative z-20 mx-auto" style={{ height: 260, maxWidth: 560 }} data-testid="casino-seats">
              {(() => {
                const all = round?.seats || state?.seats || [];
                // Put "you" at the bottom-center; others spread around the arc.
                const meIdx = all.findIndex((s) => s.user_id === user?.id);
                const seats = meIdx > 0 ? [all[meIdx], ...all.slice(0, meIdx), ...all.slice(meIdx + 1)] : all;
                const n = Math.max(seats.length, 1);
                return seats.map((s, i) => {
                  const theta = (Math.PI / 2) + (i * 2 * Math.PI) / n; // start at bottom
                  const x = 50 + 40 * Math.cos(theta);
                  const y = 52 + 40 * Math.sin(theta);
                  const win = round?.winner_user_id && s.user_id === round.winner_user_id;
                  const cards = round?.seats ? (s.cards || []) : [null];
                  const isMe = s.user_id === user?.id;
                  return (
                    <div key={s.user_id} data-testid={`casino-seat-${s.user_id}`}
                      className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
                      style={{ left: `${x}%`, top: `${y}%`, width: 96 }}>
                      <div className="flex gap-1">
                        {cards.map((c, j) => c ? <PlayingCard key={j} code={c} size="sm" /> : <PlayingCard key={j} faceDown size="sm" />)}
                      </div>
                      <div className={`vegas-seat flex items-center gap-1.5 rounded-full px-2 py-1 ${win ? "vegas-seat--active bg-amber-300/95" : "bg-black/35 ring-1 ring-white/15"}`}>
                        <PlayerAvatar seed={s.user_id} name={s.display_name} size={22} />
                        <span className={`max-w-[70px] truncate text-[11px] font-bold ${win ? "text-amber-900" : "text-white"}`}>
                          {isMe ? "You" : s.display_name}{win ? " 🏆" : ""}
                        </span>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>

          {round?.phase === "SETTLED" && (
            <div className="mt-4 rounded-2xl border border-slate-100 bg-white p-4 text-sm" data-testid="casino-result">
              <p className="font-bold text-slate-900">{round.winner_display_name} won {round.payout} coins <span className="font-medium text-slate-400">(pot {round.pot}, rake {round.rake})</span></p>
            </div>
          )}

          <button data-testid="casino-start" onClick={startRound} disabled={busy || (state?.seat_count || 0) < (state?.min_players || 2)}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-royal py-4 text-sm font-bold text-white shadow-lift transition-transform hover:-translate-y-0.5 disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {(state?.seat_count || 0) < (state?.min_players || 2) ? `Waiting for players (${state?.seat_count}/${state?.min_players})` : round?.phase === "SETTLED" ? "Deal Next Round" : "Deal"}
          </button>

          {/* Provably fair */}
          {round?.commit_hash && (
            <div className="mt-4 rounded-2xl border border-slate-100 bg-white p-4" data-testid="casino-fairness">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500"><ShieldCheck className="h-4 w-4 text-emerald-600" /> Provably Fair</p>
              <p className="mt-2 break-all font-mono text-[11px] text-slate-500">commit: {round.commit_hash}</p>
              {round.phase === "SETTLED" && (
                <button data-testid="casino-verify-btn" onClick={() => runVerify(round.id)} disabled={busy} className="mt-3 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100">Verify this round</button>
              )}
              {verify && (
                <div className="mt-3 rounded-xl bg-slate-50 p-3 text-[11px]" data-testid="casino-verify-result">
                  <p className={`flex items-center gap-1.5 font-bold ${verify.recomputed_matches ? "text-emerald-600" : "text-rose-600"}`}>
                    {verify.recomputed_matches ? <><Check className="h-4 w-4" /> Verified — the deal matches the pre-committed hash</> : <><X className="h-4 w-4" /> Mismatch</>}
                  </p>
                  <p className="mt-1.5 break-all font-mono text-slate-400">seed: {verify.server_seed}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
