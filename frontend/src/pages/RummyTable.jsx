import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, LogOut, ShieldCheck, Check, X, Layers, Hand, Flag, Trophy, Sparkles, Wifi, WifiOff } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { classifyGroup, evaluateHand, provisionalDeadwood } from "@/lib/rummy";
import { RummyAmbiance } from "@/components/RummyAmbiance";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const SUIT = { s: "\u2660", h: "\u2665", d: "\u2666", c: "\u2663" };
const RED = new Set(["h", "d"]);

// Per-player table skins — only the felt surface + accent/background change; the
// card art, layout and live meld-assist are identical across themes.
const THEMES = {
  luxury: { label: "Charcoal", gold: "#d4af37", felt: "#141110", swatch: "#1a1614",
    bg: "radial-gradient(1200px 600px at 50% -10%, #221c19 0%, #141110 55%, #0c0a09 100%)",
    panel: "linear-gradient(180deg, rgba(30,25,22,.9), rgba(16,13,12,.95))" },
  red_felt: { label: "Red Felt", gold: "#f0d68a", felt: "#5c1018", swatch: "#7a1420",
    bg: "radial-gradient(1200px 600px at 50% -10%, #7a1420 0%, #4a0d14 55%, #2a070b 100%)",
    panel: "linear-gradient(180deg, rgba(122,20,32,.5), rgba(74,13,20,.85))" },
  green_felt: { label: "Green Felt", gold: "#e8d59a", felt: "#0f5132", swatch: "#0f5132",
    bg: "radial-gradient(1200px 600px at 50% -10%, #14663f 0%, #0c3d26 55%, #062316 100%)",
    panel: "linear-gradient(180deg, rgba(15,81,50,.5), rgba(9,48,30,.9))" },
};

const RCard = ({ card, selected, onClick, small, plain }) => {
  const size = small ? "h-12 w-9 text-sm" : "h-16 w-11 text-base";
  if (!card) return <span className={`grid ${size} place-items-center rounded-lg border border-dashed border-white/15 bg-white/5 text-white/30`}>?</span>;
  const face = card.joker ? (
    <span className={`grid ${size} place-items-center rounded-lg border font-black shadow ${selected ? "-translate-y-2 border-[var(--r-gold)] ring-2 ring-[var(--r-gold)]" : "border-amber-300/40"} bg-gradient-to-br from-amber-300 to-yellow-600 text-black`}>
      <Sparkles className="h-4 w-4" />
      <span className="text-[8px] font-bold leading-none">JOKER</span>
    </span>
  ) : (
    <span className={`grid ${size} place-items-center rounded-lg border bg-[#f7f2e7] font-black leading-none shadow ${selected ? "-translate-y-2 border-[var(--r-gold)] ring-2 ring-[var(--r-gold)]" : "border-black/10"} ${RED.has(card.suit) ? "text-rose-600" : "text-slate-900"}`}>
      <span>{card.rank === "T" ? "10" : card.rank}</span>
      <span className="text-xs">{SUIT[card.suit]}</span>
    </span>
  );
  if (plain) return <span data-testid={`rcard-${card.id}`} className="transition-transform">{face}</span>;
  return (
    <button type="button" onClick={onClick} data-testid={`rcard-${card.id}`} className="transition-transform">
      {face}
    </button>
  );
};

const Timer = ({ deadline, active }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  if (!deadline) return null;
  const remain = Math.max(0, Math.round((new Date(deadline).getTime() - now) / 1000));
  const danger = remain <= 5;
  return (
    <span data-testid="rummy-turn-timer"
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-black tabular-nums ${active ? (danger ? "animate-pulse bg-rose-500 text-white" : "bg-[var(--r-gold)] text-black") : "bg-white/10 text-white/60"}`}>
      {remain}s
    </span>
  );
};

export default function RummyTable({ tableId, onLeave }) {
  const { user, token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [state, setState] = useState(null);
  const [groups, setGroups] = useState([]);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [conn, setConn] = useState(true);
  const [showDrop, setShowDrop] = useState(false);
  const [verify, setVerify] = useState(null);
  const [showSummary, setShowSummary] = useState(false);
  const [theme, setTheme] = useState(() => user?.rummy_theme || localStorage.getItem("royal11_rummy_theme") || "luxury");
  const th = THEMES[theme] || THEMES.luxury;
  const changeTheme = (key) => {
    setTheme(key);
    localStorage.setItem("royal11_rummy_theme", key);
    axios.put(`${API}/auth/rummy-theme`, { theme: key }, { headers }).catch(() => {});
  };
  const pollRef = useRef(null);
  const hbRef = useRef(0);
  const summaryShownFor = useRef(null);

  const round = state?.round;
  const wildRank = round?.wild?.rank;
  const hand = round?.your_hand || [];
  const byId = useMemo(() => Object.fromEntries(hand.map((c) => [c.id, c])), [hand]);
  const myTurn = !!round?.turn?.is_you && round?.phase === "PLAYING";
  const drawDone = !!round?.turn?.draw_done;

  const loadState = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/casino/rummy/tables/${tableId}/state`, { headers });
      setState(data);
      setConn(true);
    } catch { setConn(false); }
  }, [tableId, headers]);

  useEffect(() => {
    loadState();
    pollRef.current = setInterval(() => {
      loadState();
      hbRef.current += 1;
      if (hbRef.current % 3 === 0) axios.post(`${API}/casino/rummy/tables/${tableId}/heartbeat`, {}, { headers }).catch(() => {});
    }, 1500);
    return () => clearInterval(pollRef.current);
  }, [loadState, tableId, headers]);

  // Reconcile local grouping with the authoritative hand every state refresh.
  const handKey = hand.map((c) => c.id).sort().join(",");
  useEffect(() => {
    const ids = new Set(hand.map((c) => c.id));
    setGroups((prev) => prev.map((g) => g.filter((id) => ids.has(id))).filter((g) => g.length));
    setSelected((prev) => prev.filter((id) => ids.has(id)));
  }, [handKey]);

  // Show the post-round summary once per settled round (guard against poll
  // refreshes re-opening it after the player dismisses it).
  useEffect(() => {
    if (round?.phase === "SETTLED" && round?.result && summaryShownFor.current !== round.id) {
      summaryShownFor.current = round.id;
      setShowSummary(true);
    }
  }, [round?.phase, round?.result, round?.id]);

  const groupedIds = useMemo(() => new Set(groups.flat()), [groups]);
  const trayCards = hand.filter((c) => !groupedIds.has(c.id));
  const groupInfos = groups.map((g) => classifyGroup(g.map((id) => byId[id]).filter(Boolean), wildRank));
  const evalResult = evaluateHand(groups.map((g) => g.map((id) => byId[id]).filter(Boolean)), wildRank);
  const provisional = provisionalDeadwood(hand.map((c) => c), wildRank);

  const act = async (fn) => { setBusy(true); try { return await fn(); } finally { setBusy(false); } };
  const post = (path, body) => axios.post(`${API}/casino/rummy/tables/${tableId}/${path}`, body || {}, { headers });

  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const newGroup = () => { if (!selected.length) return; setGroups((g) => [...g, [...selected]]); setSelected([]); };
  const addTo = (gi) => { if (!selected.length) return; setGroups((g) => g.map((grp, i) => (i === gi ? [...grp, ...selected.filter((id) => !grp.includes(id))] : grp))); setSelected([]); };
  const pullOut = (id) => { setGroups((g) => g.map((grp) => grp.filter((x) => x !== id)).filter((grp) => grp.length)); };

  const doStart = () => act(async () => { const { data } = await post("start"); setState(data); }).catch((e) => toast.error(e.response?.data?.detail || "Couldn't deal"));
  const doDraw = (source) => act(async () => { const { data } = await post("draw", { source }); setState(data); }).catch((e) => toast.error(e.response?.data?.detail || "Couldn't draw"));
  const doDiscard = () => act(async () => {
    if (selected.length !== 1) return toast.error("Select exactly one card to discard");
    const { data } = await post("discard", { card_id: selected[0] }); setState(data); setSelected([]);
  }).catch((e) => toast.error(e.response?.data?.detail || "Couldn't discard"));
  const doDeclare = () => act(async () => {
    const { data } = await post("declare", { groups }); setState(data);
    toast.success("Valid declaration — you win! \u{1F3C6}");
  }).catch((e) => toast.error(e.response?.data?.detail || "Invalid declaration"));
  const doDrop = () => act(async () => { setShowDrop(false); const { data } = await post("drop"); setState(data); }).catch((e) => toast.error(e.response?.data?.detail || "Couldn't drop"));
  const doLeave = () => act(async () => { await axios.post(`${API}/casino/tables/${tableId}/leave`, {}, { headers }); onLeave(); }).catch((e) => toast.error(e.response?.data?.detail || "Couldn't leave"));
  const runVerify = () => act(async () => { const { data } = await axios.get(`${API}/casino/rummy/rounds/${round.id}/verify`, { headers }); setVerify(data); }).catch(() => toast.error("Verify failed"));

  if (!state) return <div className="grid min-h-[60vh] place-items-center"><Loader2 className="h-7 w-7 animate-spin text-[var(--r-gold)]" /></div>;

  const players = round?.players || state.seats?.map((s) => ({ ...s, is_you: s.user_id === user?.id, status: "seated" })) || [];
  const playing = round?.phase === "PLAYING";
  const settled = round?.phase === "SETTLED";
  const canStart = !round || settled;

  return (
    <div data-testid="rummy-table" data-rummy-theme={theme}
      className="relative min-h-screen overflow-hidden text-white"
      style={{ background: th.bg, "--r-gold": th.gold, "--r-felt": th.felt }}>
      <RummyAmbiance />
      <div className="relative z-10 mx-auto max-w-3xl px-4 pb-40 pt-5 lg:max-w-5xl">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl border border-[var(--r-gold)]/40 bg-white/5 text-[var(--r-gold)]"><Layers className="h-5 w-5" /></span>
            <div>
              <p className="font-display text-lg font-extrabold tracking-tight">{state.name}</p>
              <p className="flex items-center gap-2 text-[11px] text-white/50">
                <span>Points Rummy · {round?.config?.point_value ?? state.config?.point_value ?? 1}/pt</span>
                {(state.is_practice || round?.is_practice) && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-black uppercase text-amber-300" data-testid="rummy-practice-tag">Practice</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Theme picker */}
            <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/20 p-1" data-testid="rummy-theme-picker">
              {Object.entries(THEMES).map(([key, t]) => (
                <button key={key} data-testid={`rummy-theme-${key}`} onClick={() => changeTheme(key)} title={t.label}
                  className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${theme === key ? "border-[var(--r-gold)]" : "border-white/20"}`}
                  style={{ background: t.swatch }} />
              ))}
            </div>
            <span data-testid="rummy-conn" className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${conn ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/20 text-rose-300 animate-pulse"}`}>
              {conn ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}{conn ? "Live" : "Reconnecting"}
            </span>
            <button data-testid="rummy-leave" onClick={doLeave} disabled={busy || playing}
              className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/5 disabled:opacity-40"><LogOut className="h-3.5 w-3.5" /> Leave</button>
          </div>
        </div>

        {/* Opponents + wild */}
        <div className="rounded-3xl border border-[var(--r-gold)]/20 p-4 shadow-2xl" style={{ background: th.panel }}>
          <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="rummy-players">
            {players.map((p) => {
              const isTurn = round?.turn?.user_id === p.user_id && playing;
              return (
                <div key={p.user_id} className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${isTurn ? "border-[var(--r-gold)] bg-[var(--r-gold)]/10" : "border-white/10 bg-white/5"}`}>
                  <span className={`h-2 w-2 rounded-full ${p.status === "active" || p.status === "seated" ? "bg-emerald-400" : p.status === "dropped" ? "bg-amber-400" : "bg-rose-400"}`} />
                  <span className="font-bold">{p.display_name}{p.is_you ? " (You)" : ""}</span>
                  {p.card_count != null && <span className="text-white/40">{p.card_count} cards</span>}
                  {settled && p.points != null && <span className="font-black text-[var(--r-gold)]">{p.points}pt</span>}
                  {isTurn && <Timer deadline={round?.turn?.deadline} active />}
                </div>
              );
            })}
          </div>

          {/* Piles */}
          {round && (
            <div className="flex items-center justify-center gap-6 py-2">
              <div className="text-center">
                <button data-testid="rummy-draw-closed" disabled={!myTurn || drawDone || busy} onClick={() => doDraw("closed")}
                  className="grid h-16 w-11 place-items-center rounded-lg border border-[var(--r-gold)]/40 bg-gradient-to-br from-[#2a2320] to-[#15110f] text-[var(--r-gold)] shadow disabled:opacity-40">
                  <Layers className="h-5 w-5" />
                </button>
                <p className="mt-1 text-[10px] text-white/40">Deck ({round.closed_count})</p>
              </div>
              <div className="text-center">
                <button data-testid="rummy-draw-open" disabled={!myTurn || drawDone || busy} onClick={() => doDraw("open")} className="disabled:opacity-50">
                  <RCard card={round.open_top} plain />
                </button>
                <p className="mt-1 text-[10px] text-white/40">Discard</p>
              </div>
              <div className="text-center">
                <div className="grid h-16 w-11 place-items-center rounded-lg border border-amber-300/40 bg-amber-300/10">
                  <RCard card={{ ...(round.wild.code === "JK" ? { joker: true, id: "wild" } : { id: "wild", code: round.wild.code, rank: round.wild.code[0], suit: round.wild.code[1] }) }} small plain />
                </div>
                <p className="mt-1 text-[10px] text-white/40">Wild</p>
              </div>
            </div>
          )}
        </div>

        {/* Start / waiting */}
        {canStart && (
          <button data-testid="rummy-start" onClick={doStart} disabled={busy || (state.seat_count || 0) < 2}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--r-gold)] py-4 text-sm font-black text-black shadow-lg transition-transform hover:-translate-y-0.5 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers className="h-4 w-4" />}
            {(state.seat_count || 0) < 2 ? `Waiting for players (${state.seat_count}/2)` : settled ? "Deal Next Hand" : "Deal"}
          </button>
        )}

        {/* Meld-assist checklist */}
        {playing && (
          <div className="mt-5">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-bold" data-testid="rummy-checklist">
              <Chip ok={evalResult.checklist.pure} label="Pure Sequence" />
              <Chip ok={evalResult.checklist.twoSeq} label="2 Sequences" />
              <Chip ok={evalResult.checklist.allGrouped} label={`All 13 grouped (${evalResult.grouped}/13)`} />
              <span className="ml-auto rounded-full bg-white/5 px-3 py-1 text-white/60">Est. deadwood: <b className="text-[var(--r-gold)]">{provisional}</b></span>
            </div>

            {/* Group lanes */}
            <div className="space-y-2" data-testid="rummy-groups">
              {groups.map((g, gi) => {
                const info = groupInfos[gi];
                const color = info.type === "pure_seq" ? "text-emerald-300 border-emerald-400/40" : info.type === "impure_seq" ? "text-sky-300 border-sky-400/40" : info.type === "set" ? "text-violet-300 border-violet-400/40" : "text-rose-300 border-rose-400/40";
                return (
                  <div key={gi} className={`rounded-2xl border bg-white/[0.03] p-2 ${color}`} data-testid={`rummy-group-${gi}`}>
                    <div className="mb-1.5 flex items-center justify-between px-1 text-[11px] font-black">
                      <span className="inline-flex items-center gap-1">{info.valid ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />} {info.label}</span>
                      <button onClick={() => addTo(gi)} disabled={!selected.length} className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/70 disabled:opacity-30">+ add</button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {g.map((id) => byId[id] && <RCard key={id} card={byId[id]} small onClick={() => pullOut(id)} />)}
                    </div>
                  </div>
                );
              })}
              <button data-testid="rummy-new-group" onClick={newGroup} disabled={!selected.length}
                className="w-full rounded-2xl border border-dashed border-white/15 py-2 text-xs font-bold text-white/50 hover:bg-white/5 disabled:opacity-30">+ New group from selected ({selected.length})</button>
            </div>

            {/* Hand tray */}
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-3" data-testid="rummy-hand-tray">
              <p className="mb-2 text-[11px] font-bold text-white/40">Your hand · tap to select, then group</p>
              <div className="flex flex-wrap gap-1.5">
                {trayCards.length ? trayCards.map((c) => <RCard key={c.id} card={c} selected={selected.includes(c.id)} onClick={() => toggle(c.id)} />) : <span className="text-xs text-white/30">All cards grouped</span>}
              </div>
            </div>

            {/* Action bar */}
            <div className="mt-4 grid grid-cols-3 gap-2">
              <button data-testid="rummy-discard" onClick={doDiscard} disabled={!myTurn || !drawDone || selected.length !== 1 || busy}
                className="flex items-center justify-center gap-1.5 rounded-2xl bg-white/10 py-3 text-sm font-bold text-white disabled:opacity-40"><Hand className="h-4 w-4" /> Discard</button>
              <button data-testid="rummy-declare" onClick={doDeclare} disabled={!myTurn || !drawDone || !evalResult.canDeclare || busy}
                className="flex items-center justify-center gap-1.5 rounded-2xl bg-emerald-500 py-3 text-sm font-black text-black disabled:opacity-40"><Trophy className="h-4 w-4" /> Declare</button>
              <button data-testid="rummy-drop" onClick={() => setShowDrop(true)} disabled={!myTurn || drawDone || busy}
                className="flex items-center justify-center gap-1.5 rounded-2xl bg-white/10 py-3 text-sm font-bold text-amber-300 disabled:opacity-40"><Flag className="h-4 w-4" /> Drop</button>
            </div>
            {!myTurn && <p className="mt-2 text-center text-xs text-white/40" data-testid="rummy-wait-turn">Waiting for your turn…</p>}
          </div>
        )}

        {/* Provably fair */}
        {round?.commit_hash && (
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4" data-testid="rummy-fairness">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/50"><ShieldCheck className="h-4 w-4 text-emerald-400" /> Provably Fair</p>
            <p className="mt-2 break-all font-mono text-[10px] text-white/40">commit: {round.commit_hash}</p>
            {settled && <button data-testid="rummy-verify-btn" onClick={runVerify} disabled={busy} className="mt-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-1.5 text-xs font-bold text-emerald-300">Verify this deal</button>}
            {verify && <p className={`mt-2 text-[11px] font-bold ${verify.recomputed_matches ? "text-emerald-300" : "text-rose-300"}`} data-testid="rummy-verify-result">{verify.recomputed_matches ? "Verified \u2014 the shuffle matches the pre-committed hash" : "Mismatch"}</p>}
          </div>
        )}
      </div>

      {/* Drop confirm */}
      {showDrop && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6" data-testid="rummy-drop-modal">
          <div className="w-full max-w-xs rounded-3xl border border-white/10 bg-[#1a1614] p-6 text-center">
            <Flag className="mx-auto h-8 w-8 text-amber-300" />
            <p className="mt-3 font-display text-lg font-extrabold">Drop this hand?</p>
            <p className="mt-1 text-sm text-white/50">You&apos;ll concede {round?.players?.find((p) => p.is_you)?.has_ever_drawn === false ? 20 : 40} points and sit out this deal.</p>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setShowDrop(false)} className="flex-1 rounded-2xl bg-white/10 py-3 text-sm font-bold">Cancel</button>
              <button data-testid="drop-confirm" onClick={doDrop} className="flex-1 rounded-2xl bg-amber-400 py-3 text-sm font-black text-black">Drop</button>
            </div>
          </div>
        </div>
      )}

      {/* Post-round summary */}
      {showSummary && round?.result && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-6" data-testid="rummy-summary">
          <div className="w-full max-w-md rounded-3xl border border-[var(--r-gold)]/30 bg-[#1a1614] p-6">
            <div className="text-center">
              <Trophy className="mx-auto h-9 w-9 text-[var(--r-gold)]" />
              <p className="mt-2 font-display text-xl font-extrabold">{round.result.winner_display_name || "No"} wins</p>
              <p className="text-xs text-white/50">{round.result.reason} · pot {round.result.pot} · rake {round.result.rake}</p>
            </div>
            <div className="mt-4 space-y-1.5">
              {round.result.players.map((p) => (
                <div key={p.user_id} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-sm" data-testid={`summary-row-${p.user_id}`}>
                  <span className="font-bold">{p.display_name}{p.user_id === user?.id ? " (You)" : ""}</span>
                  <span className="flex items-center gap-3">
                    <span className="text-white/50">{p.points} pts</span>
                    <span className={`font-black ${p.delta >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{p.delta >= 0 ? "+" : ""}{p.delta}</span>
                  </span>
                </div>
              ))}
            </div>
            {round.result.players.find((p) => p.user_id === user?.id && p.error) && (
              <p className="mt-3 rounded-xl bg-rose-500/15 px-3 py-2 text-xs text-rose-300">Your declaration was invalid: {round.result.players.find((p) => p.user_id === user?.id).error}</p>
            )}
            <button data-testid="summary-close" onClick={() => setShowSummary(false)} className="mt-5 w-full rounded-2xl bg-[var(--r-gold)] py-3 text-sm font-black text-black">Continue</button>
          </div>
        </div>
      )}
    </div>
  );
}

const Chip = ({ ok, label }) => (
  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${ok ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-white/40"}`}>
    {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}{label}
  </span>
);
