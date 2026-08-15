import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, LogOut, ShieldCheck, Check, X, Layers, Hand, Flag, Trophy, Wifi, WifiOff, AlertTriangle, Coins, Gift } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useWallet } from "@/context/WalletContext";
import { classifyGroup, evaluateHand, provisionalDeadwood } from "@/lib/rummy";
import { RummyAmbiance } from "@/components/RummyAmbiance";
import { RummyMusic } from "@/components/RummyMusic";
import { AddCoins } from "@/components/AddCoins";
import { ReferAndEarn } from "@/components/ReferAndEarn";
import { DailyBonusWidget } from "@/components/DailyBonusWidget";
import { PlayingCard } from "@/components/PlayingCard";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { PALACE_BACKDROP, ROYAL_DEALER } from "@/lib/casinoAssets";
import { WinCelebration, Scoreboard, LowChipsPopup } from "@/components/casino/OrnatePopups";

// Full-count exposure escrowed by the server per seat each deal
// (rummy_engine: MAX_POINTS * point_value). We mirror it client-side purely as
// a heads-up so the player can top up before they get locked out of the deal.
const MAX_POINTS = 80;

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

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

const RCard = ({ card, selected, onClick, small, big, plain, rich }) => {
  const size = big ? "lg" : small ? "sm" : "md";
  if (!card) return <span className="pc-empty" style={{ width: small ? 38 : 46, height: small ? 54 : 66 }} />;
  if (plain) return <span data-testid={`rcard-${card.id}`}><PlayingCard card={card} size={size} plain rich={rich} /></span>;
  return (
    <button type="button" onClick={onClick} data-testid={`rcard-${card.id}`}
      className={`pc-btn ${selected ? "pc-sel rounded-[10px]" : ""}`}>
      <PlayingCard card={card} size={size} plain rich={rich} />
    </button>
  );
};

const SUIT_SORT = { s: 0, h: 1, c: 2, d: 3 };
const RANK_SORT = "A23456789TJQK";
// Spread the ungrouped hand by suit then rank — a tidy "fanned" reference-style row.
const bySuit = (cards) => [...cards].sort((a, b) =>
  a.joker || b.joker ? (a.joker ? 1 : -1)
    : (SUIT_SORT[a.suit] - SUIT_SORT[b.suit]) || (RANK_SORT.indexOf(a.rank) - RANK_SORT.indexOf(b.rank)));

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
  const { balance, refresh: refreshWallet } = useWallet();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [state, setState] = useState(null);
  const [groups, setGroups] = useState([]);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [conn, setConn] = useState(true);
  const [showDrop, setShowDrop] = useState(false);
  const [verify, setVerify] = useState(null);
  const [showSummary, setShowSummary] = useState(false);
  const [showAddCoins, setShowAddCoins] = useState(false);
  const [showRewards, setShowRewards] = useState(false);
  const [celebOpen, setCelebOpen] = useState(true);
  const [showLowChips, setShowLowChips] = useState(false);
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
  const rechargePromptedRef = useRef(false);

  const round = state?.round;
  const wildRank = round?.wild?.rank;
  const hand = round?.your_hand || [];
  const byId = useMemo(() => Object.fromEntries(hand.map((c) => [c.id, c])), [hand]);
  const myTurn = !!round?.turn?.is_you && round?.phase === "PLAYING";
  const drawDone = !!round?.turn?.draw_done;

  // Low-balance heads-up (cash tables only): a deal escrows MAX_POINTS *
  // point_value per seat, so warn when the wallet can't cover the next hand.
  const pointValue = round?.config?.point_value ?? state?.config?.point_value ?? 1;
  const isCashTable = !!state && !(state.is_practice || round?.is_practice);
  const reserveNeeded = MAX_POINTS * pointValue;
  const betweenRounds = !!state && (!round || round?.phase === "SETTLED");
  const lowBalance = isCashTable && balance < reserveNeeded;

  const loadState = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/casino/rummy/tables/${tableId}/state`, { headers });
      setState(data);
      setConn(true);
    } catch (e) {
      const s = e.response?.status;
      if (s === 400 || s === 404) {
        // The table was deleted / expired / is no longer valid — bail to the
        // lobby instead of polling a dead table id forever (clears localStorage).
        if (pollRef.current) clearInterval(pollRef.current);
        toast.error("This table is no longer available");
        onLeave();
        return;
      }
      setConn(false); // transient network blip — keep retrying
    }
  }, [tableId, headers, onLeave]);

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

  // Reset the one-time recharge prompt when a fresh deal begins.
  useEffect(() => { if (round?.phase === "PLAYING") rechargePromptedRef.current = false; }, [round?.phase]);

  // On a fresh/waiting table with no funds, surface the recharge sheet once so
  // the player can top up before the deal. When a round has just SETTLED we let
  // the post-round summary (which carries its own recharge CTA) show instead,
  // to avoid stacking two modals.
  useEffect(() => {
    const summaryPending = round?.phase === "SETTLED" && !!round?.result;
    if (lowBalance && betweenRounds && !summaryPending && !showSummary && !showAddCoins && !showLowChips && !rechargePromptedRef.current) {
      rechargePromptedRef.current = true;
      setShowLowChips(true);
    }
  }, [lowBalance, betweenRounds, round?.phase, round?.result, showSummary, showAddCoins, showLowChips]);

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

  const doStart = () => {
    if (lowBalance) {
      setShowAddCoins(true);
      return toast.error(`Add coins to play — you need ${reserveNeeded.toLocaleString("en-IN")} to deal`);
    }
    return act(async () => { const { data } = await post("start"); setState(data); }).catch((e) => {
      const msg = e.response?.data?.detail || "Couldn't deal";
      if (/fund|balance|enough/i.test(msg)) setShowAddCoins(true);
      toast.error(msg);
    });
  };
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
            <RummyMusic />
            <span data-testid="rummy-conn" className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${conn ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/20 text-rose-300 animate-pulse"}`}>
              {conn ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}{conn ? "Live" : "Reconnecting"}
            </span>
            <button data-testid="rummy-rewards-btn" onClick={() => setShowRewards(true)}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--r-gold)]/40 bg-[var(--r-gold)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--r-gold)] hover:bg-[var(--r-gold)]/20"><Gift className="h-3.5 w-3.5" /> Rewards</button>
            <button data-testid="rummy-leave" onClick={doLeave} disabled={busy || playing}
              className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/5 disabled:opacity-40"><LogOut className="h-3.5 w-3.5" /> Leave</button>
          </div>
        </div>

        {/* Low-balance warning */}
        {lowBalance && (
          <div data-testid="rummy-low-balance"
            className="mb-4 flex items-center gap-3 rounded-2xl border border-amber-400/50 bg-amber-500/10 p-3.5 shadow-lg">
            <span className="grid h-9 w-9 shrink-0 animate-pulse place-items-center rounded-xl bg-amber-400/20 text-amber-300">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-amber-200">Low balance</p>
              <p className="truncate text-xs text-amber-100/70">
                Next hand needs {reserveNeeded.toLocaleString("en-IN")} coins · you have {balance.toLocaleString("en-IN")}
              </p>
            </div>
            <button data-testid="rummy-recharge-btn" onClick={() => setShowAddCoins(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-400 px-4 py-2 text-xs font-black text-black transition-transform hover:scale-105 active:scale-95">
              <Coins className="h-3.5 w-3.5" /> Recharge
            </button>
          </div>
        )}

        {/* Royal palace room + host + table */}
        <div className="vegas-palace p-3 sm:p-5" style={{ backgroundImage: `url(${PALACE_BACKDROP})` }} data-testid="vegas-palace">
          <div className="mb-2 flex items-center justify-center gap-2">
            <div className="vegas-host" data-testid="vegas-host"><img src={ROYAL_DEALER} alt="Royal host" /></div>
          </div>
          <div className="vegas-felt vegas-felt--red relative overflow-hidden p-4 shadow-2xl">
          <div className="vegas-rail" />
          <div className="vegas-spotlight" />
          <div className="relative z-10 mb-3 flex flex-wrap items-start justify-center gap-4" data-testid="rummy-players">
            {players.map((p) => {
              const isTurn = round?.turn?.user_id === p.user_id && playing;
              return (
                <div key={p.user_id} data-testid={`rummy-seat-${p.user_id}`}
                  className="flex flex-col items-center gap-1">
                  <div className={`vegas-ring ${isTurn ? "vegas-ring--active" : ""}`}>
                    <span className="relative block rounded-full ring-1 ring-black/30">
                      <PlayerAvatar seed={p.user_id} name={p.display_name} size={40} />
                      <span className={`absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full ring-2 ring-black/50 ${p.status === "active" || p.status === "seated" ? "bg-emerald-400" : p.status === "dropped" ? "bg-amber-400" : "bg-rose-400"}`} />
                    </span>
                  </div>
                  <span className="max-w-[92px] truncate text-[11px] font-bold text-white drop-shadow">{p.display_name}{p.is_you ? " (You)" : ""}</span>
                  <span className="vegas-balance flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black">
                    {settled && p.points != null
                      ? <span className="text-[var(--r-gold)]">{p.points} pts</span>
                      : <>{p.is_you ? balance.toLocaleString("en-IN") : (p.card_count != null ? `${p.card_count} cards` : "seated")}</>}
                    {isTurn && <Timer deadline={round?.turn?.deadline} active />}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Piles */}
          {round && (
            <div className="relative z-10 flex items-center justify-center gap-6 py-2">
              <div className="text-center">
                <button data-testid="rummy-draw-closed" disabled={!myTurn || drawDone || busy} onClick={() => doDraw("closed")}
                  className="pc-btn disabled:opacity-40">
                  <PlayingCard faceDown size="md" />
                </button>
                <p className="mt-1 text-[10px] text-white/50">Deck ({round.closed_count})</p>
              </div>
              <div className="text-center">
                <button data-testid="rummy-draw-open" disabled={!myTurn || drawDone || busy} onClick={() => doDraw("open")} className="pc-btn disabled:opacity-50">
                  <RCard card={round.open_top} plain />
                </button>
                <p className="mt-1 text-[10px] text-white/50">Discard</p>
              </div>
              <div className="text-center">
                <div className="grid place-items-center">
                  <RCard card={{ ...(round.wild.code === "JK" ? { joker: true, id: "wild" } : { id: "wild", code: round.wild.code, rank: round.wild.code[0], suit: round.wild.code[1] }) }} plain />
                </div>
                <p className="mt-1 text-[10px] text-white/50">Wild</p>
              </div>
            </div>
          )}
          </div>
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

            {/* Hand tray — suit-sorted, glossy */}
            <div className="mt-4 rounded-2xl border border-[var(--r-gold)]/20 bg-black/40 p-3 shadow-inner" data-testid="rummy-hand-tray">
              <p className="mb-2 text-[11px] font-bold text-[var(--r-gold)]/70">Your hand · tap to select, then group</p>
              <div className="flex flex-wrap items-end gap-1.5">
                {trayCards.length ? bySuit(trayCards).map((c) => (
                  <RCard key={c.id} card={c} rich selected={selected.includes(c.id)} onClick={() => toggle(c.id)} />
                )) : <span className="text-xs text-white/30">All cards grouped</span>}
              </div>
            </div>

            {/* Action bar */}
            <div className="mt-4 grid grid-cols-3 gap-2">
              <button data-testid="rummy-discard" onClick={doDiscard} disabled={!myTurn || !drawDone || selected.length !== 1 || busy}
                className="flex items-center justify-center gap-1.5 rounded-2xl bg-[#6b0f1a] py-3 text-sm font-bold text-white ring-1 ring-[var(--r-gold)]/30 disabled:opacity-40"><Hand className="h-4 w-4" /> Discard</button>
              <button data-testid="rummy-declare" onClick={doDeclare} disabled={!myTurn || !drawDone || !evalResult.canDeclare || busy}
                className="flex items-center justify-center gap-1.5 rounded-2xl bg-[var(--r-gold)] py-3 text-sm font-black text-black disabled:opacity-40"><Trophy className="h-4 w-4" /> Declare</button>
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

      {/* Post-round summary — ornate Win celebration then Scoreboard */}
      {showSummary && round?.result && (() => {
        const items = round.result.players.map((p) => ({ ...p, is_you: p.user_id === user?.id }));
        const mine = items.find((p) => p.is_you);
        const closeAll = () => { setShowSummary(false); setCelebOpen(true); };
        if (celebOpen && mine && (mine.delta ?? 0) > 0) {
          return <WinCelebration amount={mine.delta} subtitle={`${round.result.winner_display_name || ""} wins · pot ${round.result.pot}`} onClose={() => setCelebOpen(false)} />;
        }
        return <Scoreboard players={items} onClose={closeAll} />;
      })()}

      {/* Low-balance nudge (ornate) */}
      {showLowChips && (
        <LowChipsPopup needed={reserveNeeded} have={balance}
          onGetChips={() => { setShowLowChips(false); setShowAddCoins(true); }}
          onClose={() => setShowLowChips(false)} />
      )}

      {/* Recharge sheet — top up without leaving the table */}
      <AddCoins palace open={showAddCoins} onClose={() => { setShowAddCoins(false); refreshWallet(); }} onSubmitted={refreshWallet} />

      {/* Rewards modal — Refer & Earn + Promo (opened from the Rewards top-bar button) */}
      <ReferAndEarn open={showRewards} onClose={() => setShowRewards(false)} />

      {/* Persistent HUD: Daily Bonus (bottom-left) + Emoji-only badge (bottom-right) */}
      <div className="fixed bottom-4 left-4 z-40 hidden sm:block">
        <DailyBonusWidget onClaimed={refreshWallet} />
      </div>
      <div data-testid="emoji-only-badge"
        className="fixed bottom-4 right-4 z-40 hidden items-center gap-1.5 rounded-full border border-[var(--r-gold)]/40 bg-black/60 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-[var(--r-gold)] backdrop-blur-md sm:inline-flex">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Emoji Only
      </div>
    </div>
  );
}

const Chip = ({ ok, label }) => (
  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${ok ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-white/40"}`}>
    {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}{label}
  </span>
);
