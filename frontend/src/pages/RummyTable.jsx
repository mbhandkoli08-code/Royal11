import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, LogOut, ShieldCheck, Check, X, Layers, Hand, Flag, Trophy, Wifi, WifiOff, AlertTriangle, Coins, Gift, Crown } from "lucide-react";
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
import { AAA_ROOM_BG, AAA_ROOM_HOST } from "@/lib/casinoAssets";
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
  const [showInfo, setShowInfo] = useState(false);

  const toggleFullscreen = () => {
    const el = document.documentElement;
    if (!document.fullscreenElement) el.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  };
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

  // Immersive mode: RummyTable is a full-screen overlay — hide the app's
  // floating chatbot launcher (z-95) while playing so it never covers the table.
  useEffect(() => {
    document.body.classList.add("rummy-immersive");
    return () => document.body.classList.remove("rummy-immersive");
  }, []);

  // Host character is a free cosmetic (matches the "Host" tab in My Table).
  const [hostOn, setHostOn] = useState(() => (localStorage.getItem("royal11_rummy_host") ?? "on") !== "off");
  const toggleHost = () => setHostOn((v) => { const nv = !v; localStorage.setItem("royal11_rummy_host", nv ? "on" : "off"); return nv; });

  const round = state?.round;
  const match = state?.match;
  const variant = round?.config?.variant || match?.variant || "points";
  const variantLabel = variant === "pool" ? "Pool Rummy" : variant === "deals" ? "Deals Rummy" : "Points Rummy";
  const wildRank = round?.wild?.rank;
  const hand = round?.your_hand || [];
  const byId = useMemo(() => Object.fromEntries(hand.map((c) => [c.id, c])), [hand]);
  const myTurn = !!round?.turn?.is_you && round?.phase === "PLAYING";
  const drawDone = !!round?.turn?.draw_done;

  // Low-balance heads-up (cash tables only): a deal escrows MAX_POINTS *
  // point_value per seat, so warn when the wallet can't cover the next hand.
  const pointValue = round?.config?.point_value ?? state?.config?.point_value ?? 1;
  const isCashTable = !!state && !(state.is_practice || round?.is_practice);
  const entryFeeCfg = state?.config?.entry_fee ?? match?.entry_fee ?? 0;
  const matchRunning = match?.status === "RUNNING";
  const reserveNeeded = variant === "points" ? MAX_POINTS * pointValue : entryFeeCfg;
  const betweenRounds = !!state && (!round || round?.phase === "SETTLED");
  // Pool/Deals charge the entry ONCE at match start, so only warn when there's
  // no running match (i.e. before starting a fresh match).
  const lowBalance = isCashTable && balance < reserveNeeded && (variant === "points" || !matchRunning);

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
      className="fixed inset-0 z-[70] overflow-y-auto overflow-x-hidden overscroll-contain text-white"
      style={{ background: th.bg, "--r-gold": th.gold, "--r-felt": th.felt }}>
      <RummyAmbiance />
      <div className="relative z-10 mx-auto max-w-3xl px-3 pb-32 pt-4 sm:px-4 sm:pt-5 lg:max-w-5xl">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl border border-[var(--r-gold)]/40 bg-white/5 text-[var(--r-gold)]"><Layers className="h-5 w-5" /></span>
            <div>
              <p className="font-display text-lg font-extrabold tracking-tight">{state.name}</p>
              <p className="flex items-center gap-2 text-[11px] text-white/50">
                <span data-testid="rummy-variant-label">{variant === "points" ? `Points Rummy · ${round?.config?.point_value ?? state.config?.point_value ?? 1}/pt`
                  : variant === "pool" ? `Pool Rummy · ${match?.pool_limit ?? state.config?.pool_type ?? 101} pool · ${entryFeeCfg} entry`
                  : `Deals Rummy · ${match?.num_deals ?? state.config?.num_deals ?? 2} deals · ${entryFeeCfg} entry`}</span>
                <span data-testid="rummy-room-code" className="rounded-full bg-white/10 px-2 py-0.5 font-mono font-bold text-white/70">#{String(state.id || "").slice(-7).toUpperCase()}</span>
                {(state.is_practice || round?.is_practice) && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-black uppercase text-amber-300" data-testid="rummy-practice-tag">Practice</span>}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <button data-testid="rummy-info-btn" onClick={() => setShowInfo(true)}
              className="hidden items-center gap-1 rounded-full border border-white/15 px-2.5 py-1.5 text-[11px] font-semibold text-white/60 hover:bg-white/5 sm:inline-flex" title="Table info">ⓘ Info</button>
            <button data-testid="rummy-fullscreen-btn" onClick={toggleFullscreen}
              className="hidden items-center gap-1 rounded-full border border-white/15 px-2.5 py-1.5 text-[11px] font-semibold text-white/60 hover:bg-white/5 sm:inline-flex" title="Fullscreen">⛶ Fullscreen</button>
            {/* Theme picker (cosmetic — hidden on small screens to free space) */}
            <button data-testid="rummy-host-toggle" onClick={toggleHost} title={hostOn ? "Hide host" : "Show host"}
              className={`hidden items-center gap-1 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold sm:inline-flex ${hostOn ? "border-[var(--r-gold)]/50 bg-[var(--r-gold)]/10 text-[var(--r-gold)]" : "border-white/15 text-white/50 hover:bg-white/5"}`}>
              <Crown className="h-3.5 w-3.5" /> Host
            </button>
            <div className="hidden items-center gap-1 rounded-full border border-white/10 bg-black/20 p-1 sm:flex" data-testid="rummy-theme-picker">
              {Object.entries(THEMES).map(([key, t]) => (
                <button key={key} data-testid={`rummy-theme-${key}`} onClick={() => changeTheme(key)} title={t.label}
                  className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${theme === key ? "border-[var(--r-gold)]" : "border-white/20"}`}
                  style={{ background: t.swatch }} />
              ))}
            </div>
            <span className="hidden sm:block"><RummyMusic /></span>
            <span data-testid="rummy-conn" className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${conn ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/20 text-rose-300 animate-pulse"}`}>
              {conn ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}<span className="hidden sm:inline">{conn ? "Live" : "Reconnecting"}</span>
            </span>
            <button data-testid="rummy-rewards-btn" onClick={() => setShowRewards(true)}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--r-gold)]/40 bg-[var(--r-gold)]/10 px-2.5 py-1.5 text-xs font-semibold text-[var(--r-gold)] hover:bg-[var(--r-gold)]/20"><Gift className="h-3.5 w-3.5" /><span className="hidden sm:inline"> Rewards</span></button>
            <button data-testid="rummy-leave" onClick={doLeave} disabled={busy || playing}
              className="inline-flex items-center gap-1 rounded-full border border-white/15 px-2.5 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/5 disabled:opacity-40"><LogOut className="h-3.5 w-3.5" /><span className="hidden sm:inline"> Leave</span></button>
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

        {/* Pool/Deals match HUD — live cumulative scores + progress + standings */}
        {match && variant !== "points" && (
          <div data-testid="rummy-match-hud"
            className="mb-4 rounded-2xl border border-[var(--r-gold)]/40 bg-black/40 p-3.5 shadow-lg backdrop-blur">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-black uppercase tracking-widest text-[var(--r-gold)]">
                {variant === "pool" ? `${match.pool_limit} Pool` : `${match.num_deals}-Deal Match`}
              </span>
              <span data-testid="rummy-match-progress" className="text-[11px] font-bold text-white/70">
                {variant === "pool"
                  ? `Prize ${match.prize_pool} · Deal ${match.deals_played + (match.status === "RUNNING" ? 1 : 0)}`
                  : `Prize ${match.prize_pool} · Deal ${Math.min(match.deals_played + (match.status === "RUNNING" ? 1 : 0), match.num_deals)}/${match.num_deals}`}
              </span>
            </div>
            <div className="flex flex-wrap gap-2" data-testid="rummy-match-scores">
              {(match.standings || match.players).map((p) => (
                <div key={p.user_id} data-testid={`match-score-${p.user_id}`}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ring-1 ${
                    p.won ? "bg-[var(--r-gold)]/20 text-[var(--r-gold)] ring-[var(--r-gold)]/50"
                      : p.eliminated ? "bg-rose-500/15 text-rose-300 ring-rose-400/30 line-through"
                        : "bg-white/5 text-white/80 ring-white/10"}`}>
                  <span className="max-w-[90px] truncate">{p.display_name}{p.is_you ? " (You)" : ""}</span>
                  <span className="tabular-nums text-[var(--r-gold)]">{p.score} pts</span>
                  {p.won && <Crown className="h-3 w-3" />}
                </div>
              ))}
            </div>
            {match.status === "ENDED" && (
              <p data-testid="rummy-match-over" className="mt-2 text-center text-xs font-black text-[var(--r-gold)]">
                Match over — {(match.standings || []).find((s) => s.won)?.display_name || "Winner"} wins {match.prize_pool} {state.is_practice ? "chips" : "coins"}! ({match.reason})
              </p>
            )}
          </div>
        )}

        {/* AAA Royal Table room + host + table */}
        <div className={`vegas-palace vegas-palace--aaa relative p-3 sm:p-5 ${hostOn ? "vegas-palace--hosted" : ""}`} style={{ backgroundImage: `url(${hostOn ? AAA_ROOM_HOST : AAA_ROOM_BG})` }} data-testid="vegas-palace">
          <div className="vegas-chandelier" />
          <span className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 select-none font-display text-xs font-black uppercase tracking-[0.35em] text-[var(--r-gold)]/45 sm:text-sm" data-testid="rummy-backwall">{variantLabel}</span>
          <div className="vegas-felt vegas-felt--red vegas-felt--aaa relative overflow-hidden p-4 pt-5 shadow-2xl">
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

          {/* Piles — DRAW / DISCARD / JOKER */}
          {round && (
            <div className="relative z-10 flex items-center justify-center gap-5 py-2 sm:gap-7">
              <div className="text-center">
                <button data-testid="rummy-draw-closed" disabled={!myTurn || drawDone || busy} onClick={() => doDraw("closed")}
                  className="pile-slot pc-btn disabled:opacity-40">
                  <PlayingCard faceDown size="md" />
                </button>
                <p className="pile-label">Draw {round.closed_count}</p>
              </div>
              <div className="text-center">
                <button data-testid="rummy-draw-open" disabled={!myTurn || drawDone || busy} onClick={() => doDraw("open")} className="pile-slot pc-btn disabled:opacity-50">
                  <RCard card={round.open_top} plain />
                </button>
                <p className="pile-label">Discard</p>
              </div>
              <div className="text-center">
                <div className="pile-slot grid place-items-center">
                  <RCard card={{ ...(round.wild.code === "JK" ? { joker: true, id: "wild" } : { id: "wild", code: round.wild.code, rank: round.wild.code[0], suit: round.wild.code[1] }) }} plain />
                </div>
                <p className="pile-label">Joker</p>
              </div>
            </div>
          )}

          {/* Turn indicator */}
          {playing && (
            <div className="relative z-10 mt-1 flex justify-center pb-1" data-testid="rummy-turn-indicator">
              {myTurn ? (
                <span className="turn-indicator turn-indicator--you">
                  Your Turn <Timer deadline={round?.turn?.deadline} active />
                </span>
              ) : (
                <span className="turn-indicator turn-indicator--other">
                  {(players.find((p) => p.user_id === round?.turn?.user_id)?.display_name || "Opponent")}&apos;s turn
                  <Timer deadline={round?.turn?.deadline} active />
                </span>
              )}
            </div>
          )}
          </div>
        </div>

        {/* Start / waiting */}
        {canStart && (
          <button data-testid="rummy-start" onClick={doStart} disabled={busy || (state.seat_count || 0) < 2}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--r-gold)] py-4 text-sm font-black text-black shadow-lg transition-transform hover:-translate-y-0.5 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers className="h-4 w-4" />}
            {(state.seat_count || 0) < 2 ? `Waiting for players (${state.seat_count}/2)`
              : variant !== "points" ? `Start ${variantLabel.replace(" Rummy", "")} Match`
                : settled ? "Deal Next Hand" : "Deal"}
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

      {/* Table info modal */}
      {showInfo && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" data-testid="rummy-info-modal">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowInfo(false)} />
          <div className="relative w-full max-w-sm rounded-3xl border border-[var(--r-gold)]/40 bg-[#140406] p-6 text-white shadow-2xl">
            <p className="font-display text-lg font-black text-[var(--r-gold)]">Table Info</p>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-white/50">Room code</dt><dd className="font-mono font-bold">#{String(state.id || "").slice(-7).toUpperCase()}</dd></div>
              <div className="flex justify-between"><dt className="text-white/50">Mode</dt><dd className="font-bold">Points Rummy</dd></div>
              <div className="flex justify-between"><dt className="text-white/50">Point value</dt><dd className="font-bold">{round?.config?.point_value ?? state.config?.point_value ?? 1}/pt</dd></div>
              <div className="flex justify-between"><dt className="text-white/50">Seats</dt><dd className="font-bold">{players.length}/{state.max_players ?? state.config?.max_players ?? players.length}</dd></div>
              <div className="flex justify-between"><dt className="text-white/50">Provably fair</dt><dd className="font-bold text-emerald-300">Server-shuffled</dd></div>
            </dl>
            <p className="mt-3 text-[11px] text-white/40">Cosmetics never affect gameplay. Virtual coins only · no cash value.</p>
            <button data-testid="rummy-info-close" onClick={() => setShowInfo(false)} className="mt-4 w-full rounded-2xl bg-[var(--r-gold)] py-2.5 text-sm font-black text-black">Close</button>
          </div>
        </div>
      )}

      {/* Persistent HUD: Daily Bonus (bottom-left) + Emoji-only badge (bottom-right).
          Hidden while a hand is in play so it never covers the action buttons. */}
      {!playing && (
        <div className="fixed bottom-4 left-4 z-[75] hidden sm:block">
          <DailyBonusWidget onClaimed={refreshWallet} />
        </div>
      )}
      {!playing && (
        <div data-testid="emoji-only-badge"
          className="fixed bottom-4 right-4 z-[75] hidden items-center gap-1.5 rounded-full border border-[var(--r-gold)]/40 bg-black/60 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-[var(--r-gold)] backdrop-blur-md sm:inline-flex">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Emoji Only
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
