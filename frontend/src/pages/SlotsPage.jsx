import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, LogOut, ShieldCheck, Volume2, VolumeX, RefreshCw, Coins, Crown, ChevronDown, ChevronUp, Check, Shirt } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useWallet } from "@/context/WalletContext";
import { SLOT_SYMBOLS, SYMBOL_ORDER } from "@/lib/slotAssets";
import { HostWardrobe } from "@/components/HostWardrobe";
import { getSavedOutfit, outfitById } from "@/lib/hostWardrobe";
import { soundEnabled, setSoundEnabled, playSpinStart, playReelStop, playWin, playJackpot } from "@/lib/slotSound";
import "./slots.css";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const STAKES = [10, 50, 100, 500];
const BIG = new Set(["crown", "seven"]);

function Reel({ symbol, spinning, win, near, index }) {
  return (
    <div
      data-testid={`slot-reel-${index}`}
      data-symbol={symbol}
      className={`slots-reel ${spinning ? "slots-reel--spin" : ""} ${win ? "slots-reel--win" : ""} ${near ? "slots-reel--near" : ""}`}
    >
      <img src={SLOT_SYMBOLS[symbol]} alt={symbol} draggable={false} />
    </div>
  );
}

export default function SlotsPage({ onLeave, practice: practiceProp = false }) {
  const { token, user } = useAuth();
  const { balance, refresh } = useWallet();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const [config, setConfig] = useState(null);
  const [practice, setPractice] = useState(practiceProp);
  const [practiceBal, setPracticeBal] = useState(0);
  const [stake, setStake] = useState(10);
  const [reels, setReels] = useState(["coin", "star", "diamond"]);
  const [spinningReels, setSpinningReels] = useState([false, false, false]);
  const [result, setResult] = useState(null); // last spin result
  const [busy, setBusy] = useState(false);
  const [win, setWin] = useState(null); // {payout, jackpot, symbol}
  const [sound, setSound] = useState(soundEnabled());
  const [seed, setSeed] = useState(null);
  const [showFair, setShowFair] = useState(false);
  const [history, setHistory] = useState([]);
  const [verifyResult, setVerifyResult] = useState(null);
  const [clientSeedInput, setClientSeedInput] = useState("");
  const [wardrobeOpen, setWardrobeOpen] = useState(false);
  const [hostOutfit, setHostOutfit] = useState(getSavedOutfit());
  const host = outfitById(hostOutfit);

  const cycleTimers = useRef([]);
  const stopTimers = useRef([]);

  const loadMeta = useCallback(async () => {
    try {
      const [c, s, pb, h] = await Promise.all([
        axios.get(`${API}/casino/slots/config`, { headers }),
        axios.get(`${API}/casino/slots/seed`, { headers }),
        axios.get(`${API}/casino/practice/balance`, { headers }),
        axios.get(`${API}/casino/slots/history`, { headers }),
      ]);
      setConfig(c.data);
      setSeed(s.data);
      setPracticeBal(pb.data.balance);
      setHistory(h.data);
      setStake(c.data.min_stake);
    } catch { /* ignore */ }
  }, [headers]);

  useEffect(() => { loadMeta(); }, [loadMeta]);
  useEffect(() => () => { cycleTimers.current.forEach(clearInterval); stopTimers.current.forEach(clearTimeout); }, []);

  const playable = practice ? practiceBal : balance;

  const startCycling = () => {
    setSpinningReels([true, true, true]);
    cycleTimers.current = [0, 1, 2].map((i) =>
      setInterval(() => {
        setReels((prev) => {
          const next = [...prev];
          next[i] = SYMBOL_ORDER[Math.floor(Math.random() * SYMBOL_ORDER.length)];
          return next;
        });
      }, 70 + i * 8)
    );
  };

  const stopReel = (i, finalSym, delay, cb) => {
    stopTimers.current.push(setTimeout(() => {
      clearInterval(cycleTimers.current[i]);
      setReels((prev) => { const n = [...prev]; n[i] = finalSym; return n; });
      setSpinningReels((prev) => { const n = [...prev]; n[i] = false; return n; });
      playReelStop();
      cb?.();
    }, delay));
  };

  const doSpin = async () => {
    if (busy) return;
    if (stake < (config?.min_stake || 10) || stake > (config?.max_stake || 5000)) {
      return toast.error(`Stake must be ${config?.min_stake}–${config?.max_stake} coins`);
    }
    if (playable < stake) return toast.error("Not enough " + (practice ? "practice chips" : "coins"));
    setBusy(true);
    setWin(null);
    setResult(null);
    setVerifyResult(null);
    playSpinStart();
    startCycling();
    try {
      const { data } = await axios.post(`${API}/casino/slots/spin`, { stake, is_practice: practice }, { headers });
      const syms = data.symbols;
      // near-miss: if reels 0 & 1 will match a big symbol, tease reel 3
      const nearMiss = syms[0] === syms[1] && BIG.has(syms[0]) && syms[2] !== syms[0];
      stopReel(0, syms[0], 700);
      stopReel(1, syms[1], 1150);
      stopReel(2, syms[2], nearMiss ? 2300 : 1650, () => {
        setResult(data);
        if (practice) setPracticeBal(data.balance); else refresh();
        setHistory((h) => [data, ...h].slice(0, 20));
        if (data.is_win) {
          if (data.is_jackpot) playJackpot(); else playWin(false);
          setWin({ payout: data.payout, jackpot: data.is_jackpot, symbol: data.win_symbol });
        }
        setBusy(false);
      });
    } catch (e) {
      cycleTimers.current.forEach(clearInterval);
      setSpinningReels([false, false, false]);
      setBusy(false);
      toast.error(e.response?.data?.detail || "Spin failed");
    }
  };

  const toggleSound = () => { const n = !sound; setSound(n); setSoundEnabled(n); };

  const rotateSeed = async () => {
    try {
      const { data } = await axios.post(`${API}/casino/slots/seed/rotate`, {}, { headers });
      setSeed({ server_seed_hash: data.server_seed_hash, client_seed: data.client_seed, nonce: data.nonce });
      toast.success("New seed issued", { description: "Previous seed revealed — past spins now verifiable." });
    } catch { toast.error("Couldn't rotate seed"); }
  };

  const saveClientSeed = async () => {
    try {
      const { data } = await axios.post(`${API}/casino/slots/seed/client`, { client_seed: clientSeedInput }, { headers });
      setSeed(data); setClientSeedInput("");
      toast.success("Client seed updated");
    } catch { toast.error("Couldn't set client seed"); }
  };

  const verifyLast = async () => {
    if (!result?.id) return;
    try {
      const { data } = await axios.get(`${API}/casino/slots/verify/${result.id}`, { headers });
      setVerifyResult(data);
      if (!data.revealed) toast("Rotate your seed to reveal the server seed and fully verify this spin.");
    } catch { toast.error("Verify failed"); }
  };

  const burst = useMemo(() => Array.from({ length: 18 }, (_, i) => {
    const a = (Math.PI * 2 * i) / 18 + Math.random() * 0.3;
    const d = 80 + Math.random() * 120;
    return { id: i, x: `${Math.cos(a) * d}px`, y: `${Math.sin(a) * d}px`, delay: `${Math.random() * 0.15}s` };
  }), [win]);

  return (
    <div className="mx-auto max-w-lg px-4 pb-28 pt-6" data-testid="slots-page">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-amber-300 to-yellow-600 text-[#2a1503]"><Crown className="h-5 w-5" /></span>
          <div>
            <h1 className="slots-title font-display text-xl tracking-tight">777 ROYAL SLOTS</h1>
            <p className="text-[11px] font-medium text-amber-100/60">Provably fair · {config ? `${Math.round(config.rtp * 100)}% RTP` : "…"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button data-testid="slots-host-btn" onClick={() => setWardrobeOpen(true)} title="Host wardrobe"
            className="grid h-9 w-9 place-items-center rounded-full bg-black/30 text-amber-200 ring-1 ring-amber-300/30 hover:bg-black/50">
            <Shirt className="h-4 w-4" />
          </button>
          <button data-testid="slots-sound-toggle" onClick={toggleSound}
            className="grid h-9 w-9 place-items-center rounded-full bg-black/30 text-amber-200 ring-1 ring-amber-300/30 hover:bg-black/50">
            {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
          <button data-testid="slots-leave" onClick={onLeave}
            className="inline-flex items-center gap-1 rounded-full border border-amber-300/30 px-3 py-2 text-xs font-semibold text-amber-100/80 hover:bg-black/30"><LogOut className="h-3.5 w-3.5" /> Lobby</button>
        </div>
      </header>

      {/* Mode + balance */}
      <div className="mb-4 flex items-center justify-between">
        <div className="inline-flex rounded-full bg-black/30 p-1 ring-1 ring-amber-300/20" data-testid="slots-mode-toggle">
          {[{ id: false, label: "Cash" }, { id: true, label: "Practice" }].map((m) => (
            <button key={String(m.id)} data-testid={`slots-mode-${m.label.toLowerCase()}`} disabled={busy} onClick={() => setPractice(m.id)}
              className={`rounded-full px-4 py-1.5 text-xs font-bold transition-colors ${practice === m.id ? "bg-gradient-to-r from-amber-300 to-yellow-600 text-[#2a1503]" : "text-amber-100/60"}`}>{m.label}</button>
          ))}
        </div>
        <span className="slots-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-black" data-testid="slots-balance">
          <Coins className="h-4 w-4" /> {playable.toLocaleString("en-IN")}
        </span>
      </div>

      {/* Cabinet */}
      <div className="slots-stage relative p-4 sm:p-5">
        <div className="slots-bulbs" />
        {host.img && (
          <img data-testid="slots-host-portrait" src={host.img} alt={`Host — ${host.label}`}
            className="pointer-events-none absolute -top-2 right-1 z-10 h-24 w-auto rounded-xl object-cover object-top opacity-95 drop-shadow-[0_10px_20px_rgba(0,0,0,0.6)] sm:h-28"
            onClick={() => setWardrobeOpen(true)} />
        )}
        <p className="slots-title mb-3 text-center font-display text-lg">✦ ROYAL JACKPOT ✦</p>
        <div className="relative">
          <div className="slots-payline" />
          <div className="slots-reels" data-testid="slots-reels">
            {reels.map((s, i) => (
              <Reel key={i} index={i} symbol={s} spinning={spinningReels[i]}
                win={!!result?.is_win && !busy} near={i === 2 && busy && reels[0] === reels[1] && BIG.has(reels[0])} />
            ))}
          </div>
        </div>

        {/* Result line */}
        <div className="mt-3 min-h-[24px] text-center" data-testid="slots-result-line">
          {result && (result.is_win
            ? <span className="text-sm font-black text-amber-300">{result.is_jackpot ? "JACKPOT! " : "WIN! "}+{result.payout.toLocaleString("en-IN")} coins</span>
            : (!busy && <span className="text-sm font-semibold text-amber-100/50">No win — spin again</span>))}
        </div>

        {/* Stake selector */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2" data-testid="slots-stakes">
          {STAKES.filter((s) => !config || (s >= config.min_stake && s <= config.max_stake)).map((s) => (
            <button key={s} data-testid={`slots-stake-${s}`} disabled={busy} onClick={() => setStake(s)}
              className={`rounded-full px-4 py-1.5 text-xs font-bold ring-1 transition-colors ${stake === s ? "bg-gradient-to-r from-amber-300 to-yellow-600 text-[#2a1503] ring-amber-300" : "bg-black/25 text-amber-100/70 ring-amber-300/20"}`}>{s}</button>
          ))}
        </div>

        {/* Spin */}
        <button data-testid="slots-spin-btn" onClick={doSpin} disabled={busy || playable < stake}
          className="slots-spin-btn mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Crown className="h-5 w-5" />}
          {busy ? "Spinning…" : `SPIN · ${stake} coins`}
        </button>
      </div>

      {/* Paytable */}
      {config && (
        <div className="mt-4 rounded-2xl bg-black/20 p-4 ring-1 ring-amber-300/15" data-testid="slots-paytable">
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-200/80">Paytable · 3 in a row</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {config.symbols.map((s) => (
              <div key={s.key} className="flex flex-col items-center gap-1 rounded-xl bg-black/25 p-2">
                <img src={SLOT_SYMBOLS[s.key]} alt={s.key} className="h-9 w-9 object-contain" />
                <span className="text-[11px] font-black text-amber-300">{s.payout}×</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Provably fair */}
      <div className="mt-4 rounded-2xl bg-black/20 p-4 ring-1 ring-amber-300/15" data-testid="slots-fairness">
        <button onClick={() => setShowFair((v) => !v)} className="flex w-full items-center justify-between text-xs font-bold uppercase tracking-wider text-amber-200/80">
          <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-400" /> Provably Fair</span>
          {showFair ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {showFair && seed && (
          <div className="mt-3 space-y-3 text-[11px]">
            <p className="break-all font-mono text-amber-100/50">commit: {seed.server_seed_hash}</p>
            <p className="break-all font-mono text-amber-100/50">client seed: {seed.client_seed} · nonce: {seed.nonce}</p>
            <div className="flex flex-wrap gap-2">
              <input data-testid="slots-client-seed-input" value={clientSeedInput} onChange={(e) => setClientSeedInput(e.target.value)}
                placeholder="Set your own client seed" className="flex-1 rounded-full bg-black/30 px-3 py-1.5 text-amber-100 outline-none ring-1 ring-amber-300/20" />
              <button data-testid="slots-save-client-seed" onClick={saveClientSeed} className="rounded-full bg-amber-400/20 px-3 py-1.5 font-bold text-amber-200 ring-1 ring-amber-300/30"><Check className="h-3.5 w-3.5" /></button>
              <button data-testid="slots-rotate-seed" onClick={rotateSeed} className="inline-flex items-center gap-1 rounded-full bg-amber-400/20 px-3 py-1.5 font-bold text-amber-200 ring-1 ring-amber-300/30"><RefreshCw className="h-3.5 w-3.5" /> Rotate & Reveal</button>
            </div>
            {result?.id && (
              <button data-testid="slots-verify-btn" onClick={verifyLast} className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-1.5 font-bold text-emerald-300">Verify last spin</button>
            )}
            {verifyResult && (
              <p data-testid="slots-verify-result" className={`font-bold ${verifyResult.recomputed_matches ? "text-emerald-300" : "text-amber-200/70"}`}>
                {verifyResult.recomputed_matches ? "Verified — reels match the pre-committed seed" : "Rotate your seed to reveal & fully verify."}
              </p>
            )}
            <p className="text-[10px] text-amber-100/40">Tip: spin first, then tap Rotate &amp; Reveal to unlock the server seed, then Verify last spin shows Verified.</p>
          </div>
        )}
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="mt-4 rounded-2xl bg-black/20 p-4 ring-1 ring-amber-300/15" data-testid="slots-history">
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-200/80">Recent spins</p>
          <div className="space-y-1.5">
            {history.slice(0, 6).map((h) => (
              <div key={h.id} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1">{h.symbols.map((s, i) => <img key={i} src={SLOT_SYMBOLS[s]} alt={s} className="h-5 w-5 object-contain" />)}</span>
                <span className={`font-bold ${h.is_win ? "text-emerald-300" : "text-amber-100/40"}`}>{h.is_win ? `+${h.payout}` : `-${h.stake}`}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Win overlay */}
      {win && (
        <div className="slots-win-overlay" data-testid="slots-win-overlay" onClick={() => setWin(null)}>
          <div className={`slots-win-card ${win.jackpot ? "slots-win-card--jackpot" : ""}`} onClick={(e) => e.stopPropagation()}>
            <span className="slots-burst">{burst.map((b) => <i key={b.id} style={{ "--x": b.x, "--y": b.y, animationDelay: b.delay }} />)}</span>
            <div className="relative">
              {win.symbol && <img src={SLOT_SYMBOLS[win.symbol]} alt={win.symbol} className="mx-auto h-16 w-16 object-contain drop-shadow" />}
              <p className="mt-2 font-display text-2xl font-black text-amber-200">{win.jackpot ? "👑 JACKPOT!" : "YOU WIN!"}</p>
              <p className="slots-amount font-display text-5xl">{win.payout.toLocaleString("en-IN")}</p>
              <p className="text-xs font-semibold text-amber-100/70">coins</p>
              <button data-testid="slots-win-collect" onClick={() => setWin(null)} className="slots-spin-btn mt-5 w-full rounded-2xl py-3 text-sm">Collect</button>
            </div>
          </div>
        </div>
      )}

      <HostWardrobe open={wardrobeOpen} onClose={() => setWardrobeOpen(false)} onApply={setHostOutfit} />
    </div>
  );
}
