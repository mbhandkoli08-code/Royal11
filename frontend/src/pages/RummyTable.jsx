import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, LogOut, ShieldCheck, Check, X, Layers, Hand, Flag, Trophy, AlertTriangle, Coins, Gift, Crown, Plus, Settings, ArrowDownUp } from "lucide-react";
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
import { AAA_ROOM_BG, AAA_ROOM_HOST, ROYAL_HOST_CUTOUT } from "@/lib/casinoAssets";
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
    const doc = document;
    const isFs = doc.fullscreenElement || doc.webkitFullscreenElement || doc.webkitCurrentFullScreenElement;
    if (!isFs) {
      // Standard first, then WebKit (older Android Chrome / desktop Safari).
      const req = el.requestFullscreen || el.webkitRequestFullscreen || el.webkitRequestFullScreen;
      if (req) { try { Promise.resolve(req.call(el)).catch(() => {}); } catch { /* noop */ } }
      // Re-assert landscape lock once we're fullscreen (Android allows lock only
      // in fullscreen); harmless where unsupported (iOS Safari).
      const so = window.screen && window.screen.orientation;
      if (so && typeof so.lock === "function") setTimeout(() => { try { Promise.resolve(so.lock("landscape")).catch(() => {}); } catch { /* noop */ } }, 150);
    } else {
      const exit = doc.exitFullscreen || doc.webkitExitFullscreen || doc.webkitCancelFullScreen;
      if (exit) { try { Promise.resolve(exit.call(doc)).catch(() => {}); } catch { /* noop */ } }
    }
  };
  const [celebOpen, setCelebOpen] = useState(true);
  const [showLowChips, setShowLowChips] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelper, setShowHelper] = useState(false); // Declare Helper collapsed by default
  const [handSorted, setHandSorted] = useState(true);   // SORT button toggles suit-sort of the tray
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
  // floating chatbot launcher while playing, and present the card table in
  // LANDSCAPE on phones. On a portrait phone we rotate the frame 90°, but we
  // size it from the *measured* visible viewport (visualViewport / innerWidth)
  // rather than CSS 100vh/100vw — real mobile Chrome/Safari report vh/vw against
  // the URL-bar-hidden viewport, which pushed the rotated frame off-screen (blank
  // table). Driving it in JS keeps the frame exactly on the visible area.
  const frameRef = useRef(null);
  const applyFrame = useCallback(() => {
    const el = frameRef.current;
    if (!el) return;
    const vv = window.visualViewport;
    const w = Math.round((vv && vv.width) || window.innerWidth);
    const h = Math.round((vv && vv.height) || window.innerHeight);
    const isPhone = Math.min(w, h) <= 820;
    const isPortrait = h >= w;
    const compact = isPhone && (isPortrait || h <= 520);
    document.body.classList.toggle("rummy-ls", compact);
    if (isPhone && isPortrait) {
      // Rotate to landscape using exact visible-viewport pixels.
      el.style.position = "fixed";
      el.style.top = "0px";
      el.style.left = w + "px";
      el.style.width = h + "px";
      el.style.height = w + "px";
      el.style.transformOrigin = "left top";
      el.style.transform = "rotate(90deg)";
    } else {
      // Landscape phone / tablet / desktop: no manual rotation.
      el.style.position = "";
      el.style.top = "";
      el.style.left = "";
      el.style.width = "";
      el.style.height = "";
      el.style.transformOrigin = "";
      el.style.transform = "";
    }
  }, []);

  useEffect(() => {
    document.body.classList.add("rummy-immersive");
    window.addEventListener("resize", applyFrame);
    window.addEventListener("orientationchange", applyFrame);
    window.visualViewport?.addEventListener("resize", applyFrame);
    return () => {
      document.body.classList.remove("rummy-immersive");
      document.body.classList.remove("rummy-ls");
      window.removeEventListener("resize", applyFrame);
      window.removeEventListener("orientationchange", applyFrame);
      window.visualViewport?.removeEventListener("resize", applyFrame);
      const so = window.screen && window.screen.orientation;
      if (so && typeof so.unlock === "function") { try { so.unlock(); } catch { /* noop */ } }
    };
  }, [applyFrame]);

  // Re-apply the landscape frame once the table DOM actually exists — the
  // component renders a loading spinner until `state` arrives, so the frame ref
  // is null on first mount. Re-running when `state` toggles from null guarantees
  // the rotation/compact layout is applied to the real table (fixes a blank /
  // un-rotated table on real devices where data loads after mount).
  useEffect(() => { applyFrame(); }, [applyFrame, state]);


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
      // Guard: never keep a user pinned to a table they don't have a seat at
      // (e.g. a stale stored table id resuming into spectator mode). Bail to the
      // lobby so they can create/join a table where they actually get a hand.
      const seats = data.seats || [];
      const amSeated = seats.some((s) => s.user_id === user?.id);
      if (seats.length > 0 && !amSeated) {
        if (pollRef.current) clearInterval(pollRef.current);
        toast.message("You're not seated at this table — back to the lobby");
        onLeave();
        return;
      }
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
  }, [tableId, headers, onLeave, user]);

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
      if (/fund|balance|enough/i.test(msg)) {
        // We already gated on the current player's balance above (line: lowBalance).
        // If a funds error still surfaces here, it's an OPPONENT who couldn't cover
        // the entry — don't push the current player to recharge; show a neutral note.
        if (lowBalance) { setShowAddCoins(true); toast.error(msg); }
        else toast.error("Couldn't start — an opponent didn't have enough coins. Try again or pick another table.");
      } else {
        toast.error(msg);
      }
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
  // Always exit to the lobby — even if the server leave fails (e.g. the user is
  // only spectating, or a leave is restricted mid-hand). onLeave() clears the
  // stored table id, so a user can never get stuck on a table.
  const doLeave = async () => {
    setBusy(true);
    try { await axios.post(`${API}/casino/tables/${tableId}/leave`, {}, { headers }); }
    catch { /* not seated / mid-hand — leave locally anyway */ }
    finally { setBusy(false); onLeave(); }
  };
  const runVerify = () => act(async () => { const { data } = await axios.get(`${API}/casino/rummy/rounds/${round.id}/verify`, { headers }); setVerify(data); }).catch(() => toast.error("Verify failed"));

  if (!state) return <div className="grid min-h-[60vh] place-items-center"><Loader2 className="h-7 w-7 animate-spin text-[var(--r-gold)]" /></div>;

  const players = round?.players || state.seats?.map((s) => ({ ...s, is_you: s.user_id === user?.id, status: "seated" })) || [];
  // Compass-point seating for the landscape frame (Figma "MOBILE GAME 844×390"):
  // "you" always anchors the near/bottom seat; opponents fill top/left/right
  // slots. Only takes visual effect under body.rummy-ls (see casino-vegas.css).
  const opponents = players.filter((p) => !p.is_you);
  const seatSlot = (p) => {
    if (p.is_you) return "bottom-center";
    const layouts = {
      1: ["top-center"],
      2: ["left-mid", "right-mid"],
      3: ["left-mid", "top-center", "right-mid"],
      4: ["left-mid", "top-left", "top-right", "right-mid"],
      5: ["left-mid", "top-left", "top-center", "top-right", "right-mid"],
    };
    const arr = layouts[opponents.length] || layouts[5];
    const idx = opponents.findIndex((o) => o.user_id === p.user_id);
    return arr[idx] || "top-center";
  };
  const playing = round?.phase === "PLAYING";
  const settled = round?.phase === "SETTLED";
  const canStart = !round || settled;

  return (
    <div ref={frameRef} data-testid="rummy-table" data-rummy-theme={theme}
      className="fixed left-0 top-0 right-0 bottom-0 z-[70] overflow-y-auto overflow-x-hidden overscroll-contain text-white"
      style={{ background: th.bg, "--r-gold": th.gold, "--r-felt": th.felt, WebkitOverflowScrolling: "touch" }}>
      <RummyAmbiance />
      <div className="rummy-shell relative z-10 mx-auto max-w-3xl px-3 pb-32 pt-4 sm:px-4 sm:pt-5 lg:max-w-5xl">
        {/* Header — ROYAL 11 wordmark · coins+add · text links · icon row (VIP/Rewards/Sound/Settings) */}
        <div className="rummy-header mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p data-testid="rummy-wordmark" className="font-display text-2xl font-black leading-none tracking-tight text-[var(--r-gold)] sm:text-3xl" style={{ textShadow: "0 2px 12px rgba(233,198,103,0.35)" }}>
              ROYAL <span className="text-white">11</span>
            </p>
            <p className="mt-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/55 sm:text-[11px]">
              <span data-testid="rummy-variant-label">{variantLabel}</span>
              <span data-testid="rummy-room-code" className="font-mono text-white/45">#{String(state.id || "").slice(-7).toUpperCase()}</span>
              {(state.is_practice || round?.is_practice) && <span data-testid="rummy-practice-tag" className="rounded-full bg-amber-500/20 px-2 py-0.5 font-black text-amber-300">Practice</span>}
              {playing && (
                <span data-testid="rummy-header-turn"
                  className={`rummy-ls-only items-center gap-1 rounded-full px-2 py-0.5 normal-case tracking-normal ${myTurn ? "bg-[var(--r-gold)]/20 text-[var(--r-gold)]" : "bg-black/40 text-white/70"}`}>
                  {myTurn ? "Your turn" : `${(players.find((p) => p.user_id === round?.turn?.user_id)?.display_name || "Opponent")}`}
                  <Timer deadline={round?.turn?.deadline} active />
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <button data-testid="rummy-info-btn" onClick={() => setShowInfo(true)} className="hidden text-[10px] font-black uppercase tracking-wider text-white/50 hover:text-white sm:inline">ⓘ Info</button>
              <button data-testid="rummy-fullscreen-btn" onClick={toggleFullscreen} className="hidden text-[10px] font-black uppercase tracking-wider text-white/50 hover:text-white sm:inline">⛶ Fullscreen</button>
              <span data-testid="rummy-coin-balance" className="inline-flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-sm font-black text-[var(--r-gold)] ring-1 ring-[var(--r-gold)]/40">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: "radial-gradient(circle at 35% 30%, #fff7dd, #e9c667 70%, #b9882a)" }} />
                {balance.toLocaleString("en-IN")}
              </span>
              <button data-testid="rummy-add-coins" onClick={() => setShowAddCoins(true)} title="Add coins"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-500 text-white shadow-lg ring-2 ring-emerald-300/40 transition-transform hover:scale-105 active:scale-95"><Plus className="h-4 w-4" strokeWidth={3} /></button>
            </div>
            <div className="flex items-center gap-1.5" data-testid="rummy-icon-row">
              <button data-testid="rummy-vip-btn" onClick={() => setShowRewards(true)} title="VIP" className="grid h-8 w-8 place-items-center rounded-full border border-white/15 bg-black/20 text-[var(--r-gold)] transition-colors hover:bg-white/5"><Crown className="h-4 w-4" /></button>
              <button data-testid="rummy-rewards-btn" onClick={() => setShowRewards(true)} title="Rewards" className="grid h-8 w-8 place-items-center rounded-full border border-white/15 bg-black/20 text-[var(--r-gold)] transition-colors hover:bg-white/5"><Gift className="h-4 w-4" /></button>
              <span data-testid="rummy-sound"><RummyMusic /></span>
              <div className="relative">
                <button data-testid="rummy-settings-btn" onClick={() => setShowSettings((s) => !s)} title="Settings" className="grid h-8 w-8 place-items-center rounded-full border border-white/15 bg-black/20 text-white/70 transition-colors hover:bg-white/5"><Settings className="h-4 w-4" /></button>
                {showSettings && (
                  <div data-testid="rummy-settings-menu" className="absolute right-0 top-10 z-30 w-56 rounded-2xl border border-white/10 bg-[#1a1210] p-3 shadow-2xl">
                    <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-white/40">Table Settings</p>
                    <button data-testid="rummy-host-toggle" onClick={toggleHost} className="mb-1 flex w-full items-center justify-between rounded-xl px-2 py-2 text-xs font-bold hover:bg-white/5">
                      <span className="flex items-center gap-2"><Crown className="h-3.5 w-3.5 text-[var(--r-gold)]" /> Host character</span>
                      <span className={hostOn ? "text-emerald-300" : "text-white/40"}>{hostOn ? "On" : "Off"}</span>
                    </button>
                    <div className="mb-1 flex items-center justify-between rounded-xl px-2 py-2 text-xs font-bold">
                      <span>Theme</span>
                      <div className="flex gap-1">{Object.entries(THEMES).map(([key, t]) => (
                        <button key={key} data-testid={`rummy-theme-${key}`} onClick={() => changeTheme(key)} title={t.label}
                          className={`h-5 w-5 rounded-full border-2 ${theme === key ? "border-[var(--r-gold)]" : "border-white/20"}`} style={{ background: t.swatch }} />
                      ))}</div>
                    </div>
                    <button onClick={() => { setShowSettings(false); toggleFullscreen(); }} className="mb-1 flex w-full items-center gap-2 rounded-xl px-2 py-2 text-xs font-bold hover:bg-white/5">⛶ Fullscreen</button>
                    <button onClick={() => { setShowSettings(false); setShowInfo(true); }} className="mb-1 flex w-full items-center gap-2 rounded-xl px-2 py-2 text-xs font-bold hover:bg-white/5">ⓘ Table info</button>
                    <button data-testid="rummy-leave" onClick={doLeave} disabled={busy} className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-xs font-bold text-rose-300 hover:bg-rose-500/10 disabled:opacity-40"><LogOut className="h-3.5 w-3.5" /> Leave table</button>
                  </div>
                )}
              </div>
            </div>
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
          {hostOn && <img src={ROYAL_HOST_CUTOUT} alt="" aria-hidden="true" className="rummy-host-layer pointer-events-none select-none" />}
          <span className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 select-none font-display text-xs font-black uppercase tracking-[0.35em] text-[var(--r-gold)]/45 sm:text-sm" data-testid="rummy-backwall">{variantLabel}</span>
          <div className="vegas-felt vegas-felt--red vegas-felt--aaa relative overflow-hidden p-4 pt-5 shadow-2xl">
          <div className="vegas-spotlight" />
          <div className="relative z-10 mb-3 flex flex-wrap items-start justify-center gap-6" data-testid="rummy-players">
            {players.map((p) => {
              const isTurn = round?.turn?.user_id === p.user_id && playing;
              // Second line is a PUBLIC value only — never expose opponents' wallet
              // balances. Self → wallet balance; settled → points; opponent →
              // the table entry/stake (or point value), both public config.
              const sub = settled && p.points != null
                ? `${p.points} pts`
                : p.is_you
                  ? `${balance.toLocaleString("en-IN")} coins`
                  : entryFeeCfg > 0
                    ? `${entryFeeCfg.toLocaleString("en-IN")} entry`
                    : `${pointValue}/pt`;
              return (
                <div key={p.user_id} data-testid={`rummy-seat-${p.user_id}`} data-slot={seatSlot(p)}
                  className={`rummy-seat ${isTurn ? "rummy-seat--active" : ""}`}>
                  <span className="rummy-seat__av">
                    <PlayerAvatar seed={p.user_id} name={p.display_name} size={40} />
                  </span>
                  <span className="rummy-seat__txt">
                    <span data-testid={`rummy-seat-name-${p.user_id}`} className="rummy-seat__nm">
                      {p.is_you ? "You" : (p.display_name || "Player")}
                    </span>
                    <span data-testid={`rummy-seat-coins-${p.user_id}`} className="rummy-seat__sub">{sub}</span>
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
                  <RCard card={round.open_top} plain rich />
                </button>
                <p className="pile-label">Discard</p>
              </div>
              <div className="text-center">
                <div className="pile-slot grid place-items-center">
                  <RCard card={{ ...(round.wild.code === "JK" ? { joker: true, id: "wild" } : { id: "wild", code: round.wild.code, rank: round.wild.code[0], suit: round.wild.code[1] }) }} plain rich />
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

        {/* Play area — clean by default: hand tray + 6-button action bar.
            The declare-validation aids live in an optional collapsible helper. */}
        {playing && (
          <div className="rummy-playarea relative mt-5">
            {/* Hand tray — fanned, glossy (ungrouped cards) */}
            <div className="rummy-hand-tray relative rounded-2xl border border-[var(--r-gold)]/20 bg-black/40 p-3 shadow-inner" data-testid="rummy-hand-tray">
              {/* ONE row: grouped clusters + ungrouped cards. Grouping never adds a
                  second row — clusters are spaced inline with an outline + inline
                  valid/invalid marker, so the layout height stays constant. */}
              <div className="rummy-hand-row flex items-end gap-1.5">
                {groups.map((g, gi) => {
                  const info = groupInfos[gi];
                  return (
                    <div key={`grp${gi}`} data-testid={`rummy-group-${gi}`} title={info.label}
                      className={`rummy-cluster ${info.valid ? "rummy-cluster--ok" : "rummy-cluster--bad"}`}>
                      <span className="rummy-cluster__badge" data-testid={`rummy-group-badge-${gi}`}>
                        {info.valid ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                      </span>
                      {g.map((id) => byId[id] && <RCard key={id} card={byId[id]} rich onClick={() => pullOut(id)} />)}
                      {selected.length > 0 && (
                        <button data-testid={`rummy-group-add-${gi}`} onClick={() => addTo(gi)}
                          className="rummy-cluster__add">+{selected.length}</button>
                      )}
                    </div>
                  );
                })}
                {(handSorted ? bySuit(trayCards) : trayCards).map((c) => (
                  <RCard key={c.id} card={c} rich selected={selected.includes(c.id)} onClick={() => toggle(c.id)} />
                ))}
                {!trayCards.length && !groups.length && <span className="text-xs text-white/30">No cards</span>}
              </div>
              {/* On-demand declare helper — compact chip, never a permanent bar. */}
              <button data-testid="rummy-helper-toggle" onClick={() => setShowHelper((s) => !s)}
                className="rummy-helper-chip">{showHelper ? "Hide helper" : "Helper"}</button>
            </div>

            {/* Action bar — DRAW / DISCARD / SORT / GROUP / DROP / DECLARE */}
            <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6" data-testid="rummy-action-bar">
              <button data-testid="rummy-draw" onClick={() => doDraw("closed")} disabled={!myTurn || drawDone || busy}
                className="flex items-center justify-center gap-1.5 rounded-2xl bg-emerald-600 py-3 text-sm font-black text-white ring-1 ring-emerald-300/30 transition-transform hover:-translate-y-0.5 disabled:opacity-40"><Layers className="h-4 w-4" /> Draw</button>
              <button data-testid="rummy-discard" onClick={doDiscard} disabled={!myTurn || !drawDone || selected.length !== 1 || busy}
                className="flex items-center justify-center gap-1.5 rounded-2xl bg-[#6b0f1a] py-3 text-sm font-bold text-white ring-1 ring-[var(--r-gold)]/30 transition-transform hover:-translate-y-0.5 disabled:opacity-40"><Hand className="h-4 w-4" /> Discard</button>
              <button data-testid="rummy-sort" onClick={() => setHandSorted((s) => !s)} disabled={busy}
                className="flex items-center justify-center gap-1.5 rounded-2xl bg-white/10 py-3 text-sm font-bold text-white/80 ring-1 ring-white/10 transition-transform hover:-translate-y-0.5 disabled:opacity-40"><ArrowDownUp className="h-4 w-4" /> Sort</button>
              <button data-testid="rummy-group" onClick={newGroup} disabled={!selected.length || busy}
                className="flex items-center justify-center gap-1.5 rounded-2xl bg-white/10 py-3 text-sm font-bold text-white/80 ring-1 ring-white/10 transition-transform hover:-translate-y-0.5 disabled:opacity-40"><Layers className="h-4 w-4" /> Group</button>
              <button data-testid="rummy-drop" onClick={() => setShowDrop(true)} disabled={!myTurn || drawDone || busy}
                className="flex items-center justify-center gap-1.5 rounded-2xl bg-white/10 py-3 text-sm font-bold text-amber-300 ring-1 ring-white/10 transition-transform hover:-translate-y-0.5 disabled:opacity-40"><Flag className="h-4 w-4" /> Drop</button>
              <button data-testid="rummy-declare" onClick={doDeclare} disabled={!myTurn || !drawDone || !evalResult.canDeclare || busy}
                className="flex items-center justify-center gap-1.5 rounded-2xl bg-[var(--r-gold)] py-3 text-sm font-black text-black transition-transform hover:-translate-y-0.5 disabled:opacity-40"><Trophy className="h-4 w-4" /> Declare</button>
            </div>
            {/* Declare Helper — absolute overlay above the action bar; opening it
                NEVER changes the layout height (no permanent bar). */}
            {showHelper && (
              <div data-testid="rummy-declare-helper"
                className="rummy-helper-pop absolute bottom-full left-0 right-0 z-30 mb-2 rounded-2xl border border-white/10 bg-[#160a0c]/95 p-3 shadow-2xl backdrop-blur">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-bold" data-testid="rummy-checklist">
                  <Chip ok={evalResult.checklist.pure} label="Pure Sequence" />
                  <Chip ok={evalResult.checklist.twoSeq} label="2 Sequences" />
                  <Chip ok={evalResult.checklist.allGrouped} label={`All 13 grouped (${evalResult.grouped}/13)`} />
                  <span className="ml-auto rounded-full bg-white/5 px-3 py-1 text-white/60">Est. deadwood: <b className="text-[var(--r-gold)]">{provisional}</b></span>
                </div>
                <button data-testid="rummy-new-group" onClick={newGroup} disabled={!selected.length}
                  className="w-full rounded-2xl border border-dashed border-white/15 py-2 text-xs font-bold text-white/50 hover:bg-white/5 disabled:opacity-30">+ New group from selected ({selected.length})</button>
              </div>
            )}
          </div>
        )}

        {/* Provably-fair details live inside the Info popover (never a permanent
            panel in the play view). */}

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
            {round?.commit_hash && (
              <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3" data-testid="rummy-fairness-info">
                <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white/50"><ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> Provably Fair</p>
                <p className="mt-1.5 break-all font-mono text-[10px] text-white/40">commit: {round.commit_hash}</p>
                {settled && <button data-testid="rummy-verify-btn" onClick={runVerify} disabled={busy} className="mt-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-1.5 text-xs font-bold text-emerald-300">Verify this deal</button>}
                {verify && <p className={`mt-2 text-[11px] font-bold ${verify.recomputed_matches ? "text-emerald-300" : "text-rose-300"}`} data-testid="rummy-verify-result">{verify.recomputed_matches ? "Verified \u2014 the shuffle matches the pre-committed hash" : "Mismatch"}</p>}
              </div>
            )}
            <p className="mt-3 text-[11px] text-white/40">Cosmetics never affect gameplay. Virtual coins only · no cash value.</p>
            <button data-testid="rummy-info-close" onClick={() => setShowInfo(false)} className="mt-4 w-full rounded-2xl bg-[var(--r-gold)] py-2.5 text-sm font-black text-black">Close</button>
          </div>
        </div>
      )}

      {/* Daily Bonus REMINDER — hidden by default to keep the table clean; the
          widget self-reveals only in the final 10s before it becomes claimable
          (and while claimable) as a brief top-center pop-in, then hides again.
          The player's coin balance always lives in the header pill. */}
      <div className="pointer-events-none fixed left-1/2 top-16 z-[80] -translate-x-1/2">
        <div className="pointer-events-auto">
          <DailyBonusWidget onClaimed={refreshWallet} compact reminderOnly />
        </div>
      </div>
      <div data-testid="rummy-bottom-hud" className="fixed bottom-4 right-4 z-[75] hidden items-center gap-2 sm:flex">
        <span data-testid="emoji-only-badge"
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--r-gold)]/40 bg-black/60 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-[var(--r-gold)] backdrop-blur-md">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Emoji Only
        </span>
        <span data-testid="rummy-self-avatar" className="grid place-items-center rounded-full ring-2 ring-[var(--r-gold)] ring-offset-2 ring-offset-black/40">
          <PlayerAvatar seed={user?.id || "you"} name={user?.display_name || "You"} size={40} />
        </span>
      </div>
    </div>
  );
}

const Chip = ({ ok, label }) => (
  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${ok ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-white/40"}`}>
    {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}{label}
  </span>
);
