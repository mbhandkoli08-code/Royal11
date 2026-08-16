import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, LogOut, ShieldCheck, Check, X, Layers, Hand, Flag, Trophy, AlertTriangle, Coins, Gift, Crown, Plus, Settings, ArrowDownUp, Hourglass, Maximize, Minimize, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useWallet } from "@/context/WalletContext";
import { evaluateHand, groupDisplayState, provisionalDeadwood } from "@/lib/rummy";
import { RummyAmbiance } from "@/components/RummyAmbiance";
import { RotateToPlay } from "@/components/RotateToPlay";
import { RummyMusic } from "@/components/RummyMusic";
import { AddCoins } from "@/components/AddCoins";
import { GetCoinsDemo } from "@/components/casino/GetCoinsDemo";
import { ReferAndEarn } from "@/components/ReferAndEarn";
import { DailyBonusWidget } from "@/components/DailyBonusWidget";
import { PlayingCard } from "@/components/PlayingCard";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { AAA_ROOM_BG, AAA_ROOM_HOST, ROYAL_HOST_CUTOUT, MOBILE_HOST_CUTOUT, ROYAL_JOKER_ASSISTANT, ROYAL_JOKER_CARD_IMG } from "@/lib/casinoAssets";
import { WinCelebration, Scoreboard, LowChipsPopup } from "@/components/casino/OrnatePopups";
import { ClaimWinModal, RedeemCoinsModal } from "@/components/casino/CoinFlow";

// Full-count exposure escrowed by the server per seat each deal
// (rummy_engine: MAX_POINTS * point_value). We mirror it client-side purely as
// a heads-up so the player can top up before they get locked out of the deal.
const MAX_POINTS = 80;

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Per-player table skins — only the felt surface + accent/background change; the
// card art, layout and live meld-assist are identical across themes.
const THEMES = {
  luxury: { label: "Midnight Black", gold: "#e2c675", felt: "#141110", swatch: "#1a1614",
    bg: "radial-gradient(1200px 600px at 50% -10%, #221c19 0%, #141110 55%, #0c0a09 100%)",
    panel: "linear-gradient(180deg, rgba(30,25,22,.9), rgba(16,13,12,.95))" },
  red_felt: { label: "Crimson", gold: "#f0d68a", felt: "#5c1018", swatch: "#7a1420",
    bg: "radial-gradient(1200px 600px at 50% -10%, #7a1420 0%, #4a0d14 55%, #2a070b 100%)",
    panel: "linear-gradient(180deg, rgba(122,20,32,.5), rgba(74,13,20,.85))" },
  green_felt: { label: "Emerald Green", gold: "#e8d59a", felt: "#0f5132", swatch: "#0f5132",
    bg: "radial-gradient(1200px 600px at 50% -10%, #14663f 0%, #0c3d26 55%, #062316 100%)",
    panel: "linear-gradient(180deg, rgba(15,81,50,.5), rgba(9,48,30,.9))" },
  royal_blue: { label: "Royal Blue", gold: "#ecc873", felt: "#122a52", swatch: "#173a6b",
    bg: "radial-gradient(1200px 600px at 50% -10%, #1a3f78 0%, #10264c 55%, #081428 100%)",
    panel: "linear-gradient(180deg, rgba(23,58,107,.5), rgba(12,30,60,.9))" },
  purple_velvet: { label: "Purple Velvet", gold: "#ecc873", felt: "#3a1550", swatch: "#4a1d63",
    bg: "radial-gradient(1200px 600px at 50% -10%, #4a1d63 0%, #2c1140 55%, #170822 100%)",
    panel: "linear-gradient(180deg, rgba(74,29,99,.5), rgba(44,17,64,.9))" },
  champagne: { label: "Champagne Gold", gold: "#f4e2b0", felt: "#4a3a1a", swatch: "#8a6d2f",
    bg: "radial-gradient(1200px 600px at 50% -10%, #5a4a24 0%, #362a15 55%, #1c150a 100%)",
    panel: "linear-gradient(180deg, rgba(90,74,36,.5), rgba(54,42,21,.9))" },
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
const SUIT_SYM = { s: "\u2660", h: "\u2665", d: "\u2666", c: "\u2663" };
// Human label for a discarded card, e.g. "7♥" / "K♠" / "Joker".
const cardLabel = (c) => {
  if (!c) return "";
  if (c.joker) return "Joker";
  const r = c.rank === "T" ? "10" : c.rank;
  return `${r}${SUIT_SYM[c.suit] || ""}`;
};
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
  const [showDeclareConfirm, setShowDeclareConfirm] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [floatEmoji, setFloatEmoji] = useState(null);
  const [verify, setVerify] = useState(null);
  const [showSummary, setShowSummary] = useState(false);
  const [showAddCoins, setShowAddCoins] = useState(false);
  const [showGetCoins, setShowGetCoins] = useState(false);
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
  // Visual-only coin-flow modals (NOT connected to any wallet mutation — backend
  // integration is paused pending design approval).
  const [showRedeem, setShowRedeem] = useState(false);
  const [showClaim, setShowClaim] = useState(false);
  const [claimAmount, setClaimAmount] = useState(0);
  const [winRows, setWinRows] = useState([]);
  const [winReason, setWinReason] = useState("");
  const claimShownFor = useRef(null);
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
  const [needRotate, setNeedRotate] = useState(false);
  const [isCompact, setIsCompact] = useState(false);
  // On very short landscape phones the host must auto-hide so the opponent,
  // piles, all 13 cards and the six action buttons stay in a safe zone.
  const [hostFits, setHostFits] = useState(true);
  const applyFrame = useCallback(() => {
    const vv = window.visualViewport;
    const w = Math.round((vv && vv.width) || window.innerWidth);
    const h = Math.round((vv && vv.height) || window.innerHeight);
    const isPhone = Math.min(w, h) <= 820;
    const isPortrait = h >= w;
    const rotate = isPhone && isPortrait;    // phone held upright → show Rotate gate
    const compact = isPhone && !isPortrait;  // phone landscape → dedicated mobile layout
    setNeedRotate(rotate);
    setIsCompact(compact);
    // Enough landscape room for the host cutout without crowding gameplay.
    // 844×390 / 932×430 → fits; 740×360 → auto-hide.
    setHostFits(w >= 800 && h >= 372);
    document.body.classList.toggle("rummy-ls", compact);
    document.body.classList.toggle("rummy-canvas-mode", !compact && !rotate);
    document.body.classList.toggle("rummy-rotate", rotate);
    const el = frameRef.current;
    if (!el) return;
    // No portrait 90° hack anymore — the Rotate gate handles portrait phones.
    el.style.position = "";
    el.style.top = "";
    el.style.left = "";
    el.style.width = "";
    el.style.height = "";
    el.style.transformOrigin = "";
    el.style.transform = "";
    if (!compact && !rotate) {
      // Desktop / tablet landscape — uniform-scale the 1440×900 canvas.
      el.style.setProperty("--rummy-k", String(Math.min(w / 1440, h / 900)));
    } else {
      el.style.removeProperty("--rummy-k");
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
      document.body.classList.remove("rummy-canvas-mode");
      document.body.classList.remove("rummy-rotate");
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
  // ---- Genuine fullscreen detection (host is fullscreen-only on mobile) -----
  const [isFs, setIsFs] = useState(false);
  const [standalone, setStandalone] = useState(false);
  useEffect(() => {
    const onFs = () => setIsFs(!!(document.fullscreenElement || document.webkitFullscreenElement));
    // iOS/Safari has no reliable element Fullscreen API — only trust an installed
    // PWA / fullscreen display-mode signal there (never fake it from viewport).
    const checkStandalone = () => {
      try {
        const dm = window.matchMedia("(display-mode: fullscreen)").matches
          || window.matchMedia("(display-mode: standalone)").matches;
        setStandalone(dm || window.navigator.standalone === true);
      } catch { setStandalone(false); }
    };
    onFs(); checkStandalone();
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    const mqF = window.matchMedia("(display-mode: fullscreen)");
    const mqS = window.matchMedia("(display-mode: standalone)");
    mqF.addEventListener?.("change", checkStandalone);
    mqS.addEventListener?.("change", checkStandalone);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
      mqF.removeEventListener?.("change", checkStandalone);
      mqS.removeEventListener?.("change", checkStandalone);
    };
  }, []);
  // Only genuine fullscreen (or an installed PWA/fullscreen display-mode) counts.
  const fsActive = isFs || standalone;

  // Mobile-only optional host — a persisted cosmetic preference. The cutout is
  // rendered ONLY when the preference is on AND the game is in real fullscreen
  // landscape AND there is safe space for it (never covers gameplay).
  const [mobileHost, setMobileHost] = useState(() => localStorage.getItem("royal11_mobile_host") === "on");
  const toggleMobileHost = () => setMobileHost((v) => { const nv = !v; localStorage.setItem("royal11_mobile_host", nv ? "on" : "off"); return nv; });
  const mHostActive = isCompact && mobileHost && fsActive && hostFits;
  // Non-blocking notice when the host auto-hides in fullscreen on a too-small
  // landscape screen (e.g. 740×360). Not shown when merely out of fullscreen —
  // the Settings note covers that case.
  const notedHostHide = useRef(false);
  useEffect(() => {
    if (isCompact && mobileHost && fsActive && !hostFits) {
      if (!notedHostHide.current) {
        notedHostHide.current = true;
        toast("Host hidden for better gameplay view.", { duration: 2600 });
      }
    } else {
      notedHostHide.current = false;
    }
  }, [isCompact, mobileHost, fsActive, hostFits]);

  const round = state?.round;
  const match = state?.match;
  const variant = round?.config?.variant || match?.variant || "points";
  const variantLabel = variant === "pool" ? "Pool Rummy" : variant === "deals" ? "Deals Rummy" : "Points Rummy";
  const wildRank = round?.wild?.rank;
  const hand = round?.your_hand || [];
  const byId = useMemo(() => Object.fromEntries(hand.map((c) => [c.id, c])), [hand]);
  const myTurn = !!round?.turn?.is_you && round?.phase === "PLAYING";
  const drawDone = !!round?.turn?.draw_done;

  // ---- Optional local-player hand privacy (visual/privacy only) ------------
  // A persisted preference ("hide my hand while it isn't my turn"). The actual
  // visible state (handHidden) is driven by events, never by continuous polling,
  // so a manual "Tap to Show" reveal is respected until the next turn hand-off
  // or new deal. Hiding never affects dealing/rules/RNG.
  const [hidePref, setHidePref] = useState(() => localStorage.getItem("royal11_rummy_hide_hand") === "on");
  const [handHidden, setHandHidden] = useState(false);
  const myTurnRef = useRef(false); myTurnRef.current = myTurn;
  const prevTurnRef = useRef(myTurn);
  const dealRef = useRef(null);
  // Toggle the saved preference (only allowed when it's NOT the active turn).
  const toggleHidePref = () => {
    if (myTurn) return;
    setHidePref((v) => {
      const nv = !v;
      localStorage.setItem("royal11_rummy_hide_hand", nv ? "on" : "off");
      setHandHidden(nv);   // apply immediately (guaranteed not our turn here)
      return nv;
    });
  };
  // Turn transitions: reveal on your turn; re-hide once the turn passes if the
  // saved preference is enabled.
  useEffect(() => {
    const was = prevTurnRef.current;
    if (myTurn) setHandHidden(false);
    else if (was && !myTurn && hidePref) setHandHidden(true);
    prevTurnRef.current = myTurn;
  }, [myTurn, hidePref]);
  // New deal: briefly show the dealt hand as a preview, then apply the saved
  // preference if it isn't the player's turn.
  useEffect(() => {
    const rid = round?.id;
    if (!rid || round?.phase !== "PLAYING" || dealRef.current === rid) return;
    dealRef.current = rid;
    setHandHidden(false);                 // preview the freshly dealt hand
    const t = setTimeout(() => { setHandHidden(hidePref && !myTurnRef.current); }, 2600);
    return () => clearTimeout(t);
  }, [round?.id, round?.phase, hidePref]);

  // ---- Opponent discard flourish (visual only) -----------------------------
  // Detect the discard pile changing on a turn hand-off and, if it was an
  // OPPONENT's discard, animate the card seat→pile + toast the play. Never
  // reveals any other opponent card (only the single face-up discarded card).
  const [flyDiscard, setFlyDiscard] = useState(null);
  const discSnap = useRef({ openId: undefined, turnUser: undefined, seen: false });
  useEffect(() => {
    if (!round) return;
    const curOpen = round.open_top?.id;
    const curTurn = round.turn?.user_id;
    const snap = discSnap.current;
    // Fire only on a genuine turn hand-off where the top discard changed.
    if (snap.seen && curOpen && curOpen !== snap.openId && curTurn !== snap.turnUser) {
      const roster = round.players || [];
      const discarder = roster.find((p) => p.user_id === snap.turnUser);
      if (discarder && discarder.user_id !== user?.id) {
        const opps = roster.filter((p) => p.user_id !== user?.id);
        const layouts = {
          1: ["top-center"], 2: ["left-mid", "right-mid"],
          3: ["left-mid", "top-center", "right-mid"],
          4: ["left-mid", "top-left", "top-right", "right-mid"],
          5: ["left-mid", "top-left", "top-center", "top-right", "right-mid"],
        };
        const arr = layouts[opps.length] || layouts[5];
        const slot = arr[opps.findIndex((o) => o.user_id === discarder.user_id)] || "top-center";
        setFlyDiscard({ key: curOpen, card: round.open_top, slot, name: discarder.display_name });
        toast(`${discarder.display_name} discarded ${cardLabel(round.open_top)}`, { duration: 2200 });
      }
    }
    discSnap.current = { openId: curOpen, turnUser: curTurn, seen: true };
  }, [round, user]);

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

  // Offer "Claim Win" once per settled round the player won (acknowledge-only —
  // the winnings were already credited by the server at settlement).
  useEffect(() => {
    if (round?.phase === "SETTLED" && round?.result && claimShownFor.current !== round.id) {
      const parts = round.result.players || [];
      const mine = parts.find((p) => p.user_id === user?.id);
      if (mine && (mine.delta || 0) > 0) {
        claimShownFor.current = round.id;
        setClaimAmount(mine.delta);
        const nameOf = (uid) => (round.players || []).find((p) => p.user_id === uid)?.display_name || "Player";
        setWinRows(parts.map((p) => ({ name: nameOf(p.user_id), delta: p.delta || 0, points: p.points, isYou: p.user_id === user?.id })));
        setWinReason(round.result.reason || round.result.win_type || (round.result.declared ? "Valid declaration" : "Round won"));
        setShowClaim(true);
      }
    }
  }, [round?.phase, round?.result, round?.id, user?.id]);

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
  const groupDisplays = groups.map((g) => groupDisplayState(g.map((id) => byId[id]).filter(Boolean), wildRank));
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

  if (needRotate) return (
    <>
      <RotateToPlay onLeave={onLeave} />
      {/* Get Coins is a self-contained responsive overlay — keep it available in
          portrait too (e.g. if the player opened it then rotated the device). */}
      <GetCoinsDemo open={showGetCoins} onClose={() => setShowGetCoins(false)} gold={th.gold} felt={th.felt} />
      {/* The Royal Win result is a self-contained overlay too — keep it visible in
          portrait so a win that settles isn't lost behind the rotate gate. */}
      <ClaimWinModal open={showClaim} amount={claimAmount} rows={winRows} reason={winReason} gold={th.gold} felt={th.felt} onClose={() => setShowClaim(false)} />
    </>
  );
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
        {/* Header — left: R11 RUMMY · center: variant title (canvas-centered) · right: utilities + icons */}
        <div className="rummy-header relative mb-4 flex items-start justify-between gap-3">
          {/* Center title — absolutely centred to the full canvas width, aligned
              with the R11 RUMMY logo row. Hidden on compact landscape phones. */}
          <div className="pointer-events-none absolute left-1/2 top-0 z-0 flex h-7 -translate-x-1/2 items-center sm:h-8" data-testid="rummy-center-title">
            <span className="rummy-canvas-title">{variantLabel.toUpperCase()}</span>
          </div>
          <div className="min-w-0">
            <p data-testid="rummy-wordmark" className="flex items-center gap-2 leading-none">
              <Crown className="h-6 w-6 shrink-0 text-[var(--r-gold)] sm:h-7 sm:w-7" style={{ filter: "drop-shadow(0 2px 8px rgba(233,198,103,0.45))" }} strokeWidth={2.25} />
              <span className="font-display text-lg font-black uppercase leading-none tracking-[0.14em] sm:text-xl" style={{ color: "var(--r-gold)", textShadow: "0 2px 10px rgba(233,198,103,0.35)" }}>
                R11 <span className="text-white/90">RUMMY</span>
              </span>
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
          <div className="flex flex-col items-end gap-2" data-testid="rummy-header-right">
            <div className="flex items-center gap-2">
              <button data-testid="rummy-info-btn" onClick={() => setShowInfo(true)} className="hidden text-[11px] font-black uppercase tracking-wider text-white/60 hover:text-white sm:inline">ⓘ Info</button>
              <button data-testid="rummy-fullscreen-btn" onClick={toggleFullscreen} className="hidden text-[11px] font-black uppercase tracking-wider text-white/60 hover:text-white sm:inline">⛶ Fullscreen</button>
              <span data-testid="rummy-coin-balance" className="inline-flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-sm font-black text-[var(--r-gold)] ring-1 ring-[var(--r-gold)]/40">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: "radial-gradient(circle at 35% 30%, #fff7dd, #e9c667 70%, #b9882a)" }} />
                {balance.toLocaleString("en-IN")}
              </span>
              <button data-testid="rummy-add-coins" onClick={() => (isCompact ? setShowGetCoins(true) : setShowAddCoins(true))} title="Add coins"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-500 text-white shadow-lg ring-2 ring-emerald-300/40 transition-transform hover:scale-105 active:scale-95"><Plus className="h-4 w-4" strokeWidth={3} /></button>
            </div>
            <div className="flex items-start gap-2.5" data-testid="rummy-icon-row">
              <div className="rummy-iconitem flex flex-col items-center gap-1">
                <button data-testid="rummy-vip-btn" onClick={() => setShowRewards(true)} title="VIP" aria-label="VIP"
                  className="grid h-10 w-10 place-items-center rounded-full border border-[var(--r-gold)]/30 bg-black/40 text-[var(--r-gold)] transition-all hover:-translate-y-0.5 hover:bg-[var(--r-gold)]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--r-gold)]/60 active:scale-95"><Crown className="h-5 w-5" /></button>
                <span className="text-[10px] font-bold uppercase tracking-wide text-white/65">VIP</span>
              </div>
              <div className="rummy-iconitem flex flex-col items-center gap-1">
                <button data-testid="rummy-rewards-btn" onClick={() => setShowRewards(true)} title="Rewards" aria-label="Rewards"
                  className="grid h-10 w-10 place-items-center rounded-full border border-[var(--r-gold)]/30 bg-black/40 text-[var(--r-gold)] transition-all hover:-translate-y-0.5 hover:bg-[var(--r-gold)]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--r-gold)]/60 active:scale-95"><Gift className="h-5 w-5" /></button>
                <span className="text-[10px] font-bold uppercase tracking-wide text-white/65">Rewards</span>
              </div>
              <div className="rummy-iconitem flex flex-col items-center gap-1" data-testid="rummy-sound">
                <RummyMusic />
                <span className="text-[10px] font-bold uppercase tracking-wide text-white/65">Sound</span>
              </div>
              <div className="relative flex flex-col items-center gap-1">
                <button data-testid="rummy-settings-btn" onClick={() => setShowSettings((s) => !s)} title="Settings" aria-label="Settings"
                  className="grid h-10 w-10 place-items-center rounded-full border border-[var(--r-gold)]/30 bg-black/40 text-[var(--r-gold)] transition-all hover:-translate-y-0.5 hover:bg-[var(--r-gold)]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--r-gold)]/60 active:scale-95"><Settings className="h-5 w-5" /></button>
                <span className="rummy-settings-label text-[10px] font-bold uppercase tracking-wide text-white/65">Settings</span>
                {showSettings && (
                  <div data-testid="rummy-settings-menu" className="absolute right-0 top-full z-30 mt-2 w-56 rounded-2xl border border-white/10 bg-[#1a1210] p-3 text-left shadow-2xl">
                    <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-white/40">Table Settings</p>
                    {isCompact && (
                      <div className="mb-1 border-b border-white/10 pb-1">
                        <button data-testid="rummy-vip-menu" onClick={() => { setShowSettings(false); setShowRewards(true); }} className="mb-1 flex w-full items-center gap-2 rounded-xl px-2 py-2 text-xs font-bold hover:bg-white/5"><Crown className="h-3.5 w-3.5 text-[var(--r-gold)]" /> VIP</button>
                        <button data-testid="rummy-rewards-menu" onClick={() => { setShowSettings(false); setShowRewards(true); }} className="mb-1 flex w-full items-center gap-2 rounded-xl px-2 py-2 text-xs font-bold hover:bg-white/5"><Gift className="h-3.5 w-3.5 text-[var(--r-gold)]" /> Rewards</button>
                        <div className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-xs font-bold"><span className="flex items-center gap-2">Sound</span><span className="ml-auto"><RummyMusic /></span></div>
                      </div>
                    )}
                    <button data-testid="rummy-host-toggle" onClick={() => (isCompact ? toggleMobileHost() : toggleHost())} className="mb-1 flex w-full items-center justify-between rounded-xl px-2 py-2 text-xs font-bold hover:bg-white/5">
                      <span className="flex items-center gap-2"><Crown className="h-3.5 w-3.5 text-[var(--r-gold)]" /> {isCompact ? (mobileHost ? "Hide Host" : "Show Host") : "Host character"}</span>
                      <span className={(isCompact ? mobileHost : hostOn) ? "text-emerald-300" : "text-white/40"}>{(isCompact ? mobileHost : hostOn) ? "Shown" : "Hidden"}</span>
                    </button>
                    {isCompact && mobileHost && !fsActive && (
                      <p data-testid="rummy-host-note" className="mb-1 px-2 text-[10px] leading-snug text-[var(--r-gold)]/70">Host appears in fullscreen landscape mode.</p>
                    )}
                    {isCompact && mobileHost && fsActive && !hostFits && (
                      <p data-testid="rummy-host-note" className="mb-1 px-2 text-[10px] leading-snug text-white/50">Host hidden for better gameplay view.</p>
                    )}
                    <button data-testid="rummy-hand-privacy-toggle"
                      onClick={toggleHidePref}
                      disabled={myTurn}
                      title={myTurn ? "You can change this after your turn" : undefined}
                      className="mb-1 flex w-full items-center justify-between rounded-xl px-2 py-2 text-xs font-bold hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40">
                      <span className="flex items-center gap-2">{hidePref ? <Eye className="h-3.5 w-3.5 text-[var(--r-gold)]" /> : <EyeOff className="h-3.5 w-3.5 text-[var(--r-gold)]" />} {hidePref ? "Show Hand" : "Hide Hand"}</span>
                      <span className={hidePref ? "text-amber-300" : "text-white/40"}>{myTurn ? "Your turn" : (hidePref ? "Hidden" : "Visible")}</span>
                    </button>
                    <div className="mb-1 flex items-center justify-between rounded-xl px-2 py-2 text-xs font-bold">
                      <span>Theme</span>
                      <div className="flex gap-1">{Object.entries(THEMES).map(([key, t]) => (
                        <button key={key} data-testid={`rummy-theme-${key}`} onClick={() => changeTheme(key)} title={t.label}
                          className={`h-5 w-5 rounded-full border-2 ${theme === key ? "border-[var(--r-gold)]" : "border-white/20"}`} style={{ background: t.swatch }} />
                      ))}</div>
                    </div>
                    <button data-testid="rummy-fullscreen-menu" onClick={() => { setShowSettings(false); toggleFullscreen(); }} className="mb-1 flex w-full items-center gap-2 rounded-xl px-2 py-2 text-xs font-bold hover:bg-white/5">{isFs ? <Minimize className="h-3.5 w-3.5 text-[var(--r-gold)]" /> : <Maximize className="h-3.5 w-3.5 text-[var(--r-gold)]" />} {isFs ? "Exit Fullscreen" : "Fullscreen"}</button>
                    <button data-testid="rummy-redeem-open" onClick={() => { setShowSettings(false); setShowRedeem(true); }} className="mb-1 flex w-full items-center gap-2 rounded-xl px-2 py-2 text-xs font-bold hover:bg-white/5"><Coins className="h-3.5 w-3.5 text-[var(--r-gold)]" /> Redeem Coins</button>
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
        <div className={`vegas-palace vegas-palace--aaa relative p-3 sm:p-5 ${hostOn && !isCompact ? "vegas-palace--hosted" : ""} ${mHostActive ? "vegas-palace--mhost" : ""}`} style={{ backgroundImage: `url(${isCompact ? AAA_ROOM_BG : (hostOn ? AAA_ROOM_HOST : AAA_ROOM_BG)})` }} data-testid="vegas-palace">
          <div className="vegas-chandelier" />
          {/* The approved room art already contains the crimson table, so the
              CSS felt graphic is disabled here (avoids a double table). */}
          {hostOn && ROYAL_HOST_CUTOUT && <img src={ROYAL_HOST_CUTOUT} alt="" aria-hidden="true" className="rummy-host-layer pointer-events-none select-none" />}
          {mHostActive && <img src={MOBILE_HOST_CUTOUT} alt="" aria-hidden="true" data-testid="rummy-mhost-cutout" className="rummy-mhost-layer pointer-events-none select-none" />}
          <span className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 select-none font-display text-xs font-black uppercase tracking-[0.35em] text-[var(--r-gold)]/45 sm:text-sm rummy-ls-only" data-testid="rummy-backwall">{variantLabel}</span>
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
                    <span className="rummy-seat__sub">
                      <span data-testid={`rummy-seat-coins-${p.user_id}`}>{sub}</span>
                      {isTurn && isCompact && (
                        <span data-testid={`rummy-seat-timer-${p.user_id}`} className="rummy-seat__timer">
                          <Timer deadline={round?.turn?.deadline} active />
                        </span>
                      )}
                    </span>
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
                <button data-testid="rummy-draw-open" disabled={!myTurn || drawDone || busy} onClick={() => doDraw("open")} className="pile-slot pc-btn rummy-discard-pile disabled:opacity-50">
                  <span className="rummy-discard-stack" aria-hidden="true"><i /><i /></span>
                  <RCard card={round.open_top} plain rich />
                </button>
                <p className="pile-label">Discard</p>
              </div>
              <div className="text-center">
                <div className="pile-slot grid place-items-center overflow-hidden">
                  <img src={ROYAL_JOKER_CARD_IMG} alt="Joker" data-testid="rummy-joker-card" className="h-[84px] w-auto rounded-md object-contain shadow-lg" />
                </div>
                <p className="pile-label">Joker</p>
              </div>
            </div>
          )}

          {/* Opponent-discard flourish: the card animates from the discarder's
              seat into the discard pile (face-up), then clears itself. Visual
              only — never reveals any other opponent card. */}
          {flyDiscard && (() => {
            const off = { "top-center": [0, -118], "top-left": [-150, -104], "top-right": [150, -104], "left-mid": [-190, -8], "right-mid": [190, -8] }[flyDiscard.slot] || [0, -118];
            return (
              <div key={flyDiscard.key} data-testid="rummy-discard-fly" className="rummy-fly-card"
                style={{ "--fx": `${off[0]}px`, "--fy": `${off[1]}px` }}
                onAnimationEnd={() => setFlyDiscard(null)}>
                <RCard card={flyDiscard.card} plain rich />
              </div>
            );
          })()}

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
            {/* Clear YOUR TURN highlight + timer (mobile focus; desktop keeps its
                centre turn pill). Shown only while it is the local player's turn. */}
            {myTurn && (
              <div data-testid="rummy-your-turn-banner" className="rummy-your-turn rummy-ls-only">
                <span className="rummy-your-turn__dot" /> YOUR TURN
                <Timer deadline={round?.turn?.deadline} active />
              </div>
            )}
            {/* Hand tray — fanned, glossy (ungrouped cards) */}
            <div className="rummy-hand-tray relative rounded-2xl border border-[var(--r-gold)]/20 bg-black/40 p-3 shadow-inner" data-testid="rummy-hand-tray">
              {handHidden ? (
                <button type="button" data-testid="rummy-hand-hidden-panel" onClick={() => setHandHidden(false)}
                  className="rummy-hand-hidden">
                  <EyeOff className="h-5 w-5 text-[var(--r-gold)]" />
                  <span><b>{hand.length} Cards Hidden</b> — Tap to Show</span>
                </button>
              ) : (
              <>
              {/* ONE row: grouped clusters + ungrouped cards. Grouping never adds a
                  second row — clusters are spaced inline with an outline + inline
                  valid/invalid marker, so the layout height stays constant. */}
              <div className="rummy-hand-row flex items-end gap-1.5">
                {groups.map((g, gi) => {
                  const disp = groupDisplays[gi];
                  const mod = disp.state === "incomplete" ? "rummy-cluster--incomplete"
                    : disp.state === "invalid" ? "rummy-cluster--bad"
                    : disp.state === "empty" ? "rummy-cluster--incomplete"
                    : "rummy-cluster--valid";
                  const BadgeIcon = disp.state === "incomplete" ? Hourglass
                    : disp.state === "invalid" ? AlertTriangle : Check;
                  return (
                    <div key={`grp${gi}`} data-testid={`rummy-group-${gi}`} title={disp.label}
                      className={`rummy-cluster ${mod}`}>
                      {disp.state !== "empty" && (
                        <span className="rummy-cluster__label" data-testid={`rummy-group-badge-${gi}`}>
                          <BadgeIcon className="h-2.5 w-2.5" strokeWidth={2.75} />
                          {(isCompact ? disp.short : disp.label).toUpperCase()}
                        </span>
                      )}
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
              </>
              )}
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
              <button data-testid="rummy-declare" onClick={() => setShowDeclareConfirm(true)} disabled={!myTurn || !drawDone || !evalResult.canDeclare || busy}
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

      {/* Declare confirm */}
      {showDeclareConfirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6" data-testid="rummy-declare-modal">
          <div className="w-full max-w-xs rounded-3xl border border-white/10 bg-[#1a1614] p-6 text-center">
            <Trophy className="mx-auto h-8 w-8 text-[var(--r-gold)]" />
            <p className="mt-3 font-display text-lg font-extrabold">Declare your hand?</p>
            <p className="mt-1 text-sm text-white/50">Make sure your melds are valid — an invalid declare is penalised.</p>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setShowDeclareConfirm(false)} className="flex-1 rounded-2xl bg-white/10 py-3 text-sm font-bold" data-testid="declare-cancel">Cancel</button>
              <button data-testid="declare-confirm" onClick={() => { setShowDeclareConfirm(false); doDeclare(); }} className="flex-1 rounded-2xl bg-[var(--r-gold)] py-3 text-sm font-black text-black">Declare</button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Joker Assistant — round mascot + EMOJI ONLY control pinned
          bottom-RIGHT (above the action bar). Opens the Emoji panel upward. */}
      {isCompact && (
        <div className="rummy-joker-mobile" data-testid="rummy-joker-mobile-wrap">
          <span className="rummy-emoji-tag">Emoji Only</span>
          <button type="button" data-testid="rummy-joker-assistant-mobile" onClick={() => setShowEmoji((s) => !s)}
            title="Emoji Only" className="rummy-joker-mobile-btn" aria-label="Emoji Only">
            <img src={ROYAL_JOKER_ASSISTANT} alt="Emoji Only" className="h-full w-full object-contain" draggable="false" />
          </button>
        </div>
      )}

      {/* Emoji Only panel — opens UPWARD from the bottom-right Joker; compact,
          never covers cards/actions; closes on select or outside tap. */}
      {showEmoji && (
        <div className="fixed inset-0 z-[80]" data-testid="rummy-emoji-panel">
          <div className="absolute inset-0" onClick={() => setShowEmoji(false)} />
          <div className="rummy-emoji-panel-box">
            <p className="col-span-6 mb-0.5 text-[9px] font-black uppercase tracking-widest text-[var(--r-gold)]/70">Emoji Only</p>
            {["👍","👏","😄","😂","😮","😎","🤔","😢","😡","🙏","🎉","⏳"].map((e) => (
              <button key={e} type="button" data-testid={`emoji-${e}`}
                onClick={() => { setShowEmoji(false); setFloatEmoji(e); setTimeout(() => setFloatEmoji(null), 3500); }}
                className="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-lg transition-transform hover:scale-110 active:scale-95">{e}</button>
            ))}
          </div>
        </div>
      )}

      {/* Floating emoji reaction near the local player (auto-dismisses ~3.5s). */}
      {floatEmoji && (
        <div data-testid="rummy-emoji-float" className="pointer-events-none fixed bottom-[86px] left-1/2 z-[85] -translate-x-1/2 text-4xl rummy-emoji-pop">{floatEmoji}</div>
      )}


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
      <GetCoinsDemo open={showGetCoins} onClose={() => setShowGetCoins(false)} gold={th.gold} felt={th.felt} />

      {/* Visual-only coin-flow modals (mock display data — NOT wired to wallet). */}
      <ClaimWinModal open={showClaim} amount={claimAmount} rows={winRows} reason={winReason} gold={th.gold} felt={th.felt} onClose={() => setShowClaim(false)} />
      <RedeemCoinsModal open={showRedeem} balance={balance} onClose={() => setShowRedeem(false)} />

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
        <button type="button" data-testid="rummy-joker-assistant" onClick={() => setShowInfo(true)} title="Joker Assistant"
          className="grid h-12 w-12 place-items-center overflow-hidden rounded-full border-2 border-[var(--r-gold)]/70 bg-black/40 shadow-[0_6px_20px_rgba(0,0,0,0.5)] transition-transform hover:-translate-y-0.5 hover:scale-105">
          <img src={ROYAL_JOKER_ASSISTANT} alt="Joker Assistant" className="h-full w-full object-contain" />
        </button>
      </div>
    </div>
  );
}

const Chip = ({ ok, label }) => (
  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${ok ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-white/40"}`}>
    {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}{label}
  </span>
);
