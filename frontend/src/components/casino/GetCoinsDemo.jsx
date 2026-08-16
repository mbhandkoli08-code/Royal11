import { useEffect, useRef, useState } from "react";
import { X, Check, Crown, Sparkles, Coins, Zap, Smile, Layers } from "lucide-react";
import "./royal-vault.css";

// VISUAL-ONLY "ROYAL COIN VAULT" + "ROYAL MYSTERY BONUS". Everything here is a
// preview: it does NOT credit/debit coins, unlock cosmetics, call the wallet or
// backend, and never shows money, currency, payment, UPI, QR or bank details.
// The real deposit feature (AddCoins) remains separate and unchanged.

const PACKS = [
  { id: "starter", coins: 1000, bonus: 100, badge: "STARTER", tier: "starter" },
  { id: "popular", coins: 5000, bonus: 750, badge: "MOST POPULAR", tier: "popular", featured: true },
  { id: "royal", coins: 10000, bonus: 2000, badge: "BEST VALUE", tier: "royal" },
];

// Preview reward pool for the Mystery Bonus. NOTHING is credited/unlocked.
const REWARDS = [
  { id: "c100", label: "+100 Preview Coins", sub: "Preview Reward", icon: Coins },
  { id: "c250", label: "+250 Preview Coins", sub: "Preview Reward", icon: Coins },
  { id: "c500", label: "+500 Preview Coins", sub: "Preview Reward", icon: Coins },
  { id: "x2", label: "2\u00d7 Preview Bonus", sub: "Demo Reward", icon: Sparkles },
  { id: "lightning", label: "Crimson Lightning", sub: "Cosmetic Preview", icon: Zap },
  { id: "cardback", label: "Royal Card Back", sub: "Cosmetic Preview", icon: Layers },
  { id: "emote", label: "Royal Host Emote", sub: "Cosmetic Preview", icon: Smile },
];

const fmt = (n) => n.toLocaleString("en-IN");
// Decide the three cards' rewards ONCE (distinct) when the stage opens. If this
// ever becomes functional the outcome must instead come from the server.
const pick3 = () => [...REWARDS].sort(() => Math.random() - 0.5).slice(0, 3);

function CoinArt({ tier }) {
  if (tier === "royal") {
    return (
      <span className="rv-art rv-art--chest" aria-hidden="true">
        <Crown className="rv-art__crown" strokeWidth={2.1} />
        <span className="rv-coin rv-coin--a" /><span className="rv-coin rv-coin--b" /><span className="rv-coin rv-coin--c" />
      </span>
    );
  }
  return (
    <span className={`rv-art rv-art--${tier}`} aria-hidden="true">
      {tier === "popular" && <Sparkles className="rv-art__spark" />}
      <span className="rv-coin rv-coin--a" /><span className="rv-coin rv-coin--b" />
      {tier === "popular" && <span className="rv-coin rv-coin--c" />}
      <Coins className="rv-art__ico" strokeWidth={2} />
    </span>
  );
}

// Antique-gold scratch foil (real erase on drag + tap-to-auto-scratch fallback).
function ScratchFoil({ onDone }) {
  const ref = useRef(null);
  const done = useRef(false);
  const drawing = useRef(false);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const rect = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.max(1, Math.round(rect.width * dpr));
    c.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = c.getContext("2d"); ctx.scale(dpr, dpr);
    const g = ctx.createLinearGradient(0, 0, rect.width, rect.height);
    g.addColorStop(0, "#c69a3f"); g.addColorStop(0.45, "#f2dc94"); g.addColorStop(0.55, "#f8ecc0"); g.addColorStop(1, "#b3801f");
    ctx.fillStyle = g; ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = "rgba(70,40,4,0.55)"; ctx.font = "800 11px Outfit, system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText("SCRATCH", rect.width / 2, rect.height / 2 + 4);
    c._ctx = ctx;
  }, []);
  const erase = (clientX, clientY, r = 15) => {
    const c = ref.current; if (!c || !c._ctx) return;
    const rect = c.getBoundingClientRect();
    const ctx = c._ctx; ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath(); ctx.arc(clientX - rect.left, clientY - rect.top, r, 0, Math.PI * 2); ctx.fill();
  };
  const reveal = () => { if (done.current) return; done.current = true;
    const c = ref.current; if (c) { c.style.transition = "opacity .32s ease"; c.style.opacity = "0"; }
    setTimeout(() => onDone && onDone(), 280); };
  const fraction = () => {
    const c = ref.current; if (!c || !c._ctx) return 0;
    try { const d = c._ctx.getImageData(0, 0, c.width, c.height).data; let clear = 0, n = 0;
      for (let i = 3; i < d.length; i += 4 * 24) { n++; if (d[i] === 0) clear++; }
      return n ? clear / n : 0;
    } catch { return 0; }
  };
  const autoScratch = () => {
    const c = ref.current; if (!c || done.current) return;
    const rect = c.getBoundingClientRect(); let t = 0;
    const iv = setInterval(() => {
      for (let k = 0; k < 14; k++) erase(rect.left + Math.random() * rect.width, rect.top + Math.random() * rect.height, 14);
      if (++t > 9) { clearInterval(iv); reveal(); }
    }, 28);
  };
  return (
    <canvas ref={ref} data-testid="mystery-scratch" className="rv-foil"
      onPointerDown={(e) => { drawing.current = true; erase(e.clientX, e.clientY); }}
      onPointerMove={(e) => { if (drawing.current) erase(e.clientX, e.clientY); }}
      onPointerUp={() => { drawing.current = false; if (fraction() > 0.4) reveal(); }}
      onClick={autoScratch} />
  );
}

function RewardFace({ rw, muted }) {
  const Icon = rw.icon || Coins;
  return (
    <span className={`rv-myface ${muted ? "rv-myface--muted" : ""}`}>
      <span className="rv-myface__ico"><Icon className="h-full w-full" strokeWidth={2} /></span>
      <b className="rv-myface__label">{rw.label}</b>
      <small className="rv-myface__sub">{rw.sub}</small>
    </span>
  );
}

export function GetCoinsDemo({ open, onClose, gold = "#e9c667", felt = "#5c1018" }) {
  const [stage, setStage] = useState("select");     // select | mystery | confirm
  const [selectedId, setSelectedId] = useState(null);
  const [cards, setCards] = useState([]);           // 3 mystery rewards (decided once)
  const [chosen, setChosen] = useState(null);       // chosen card index
  const [revealed, setRevealed] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  if (!open) return null;

  const close = () => { setStage("select"); setSelectedId(null); setCards([]); setChosen(null); setRevealed(false); setShowOthers(false); onClose?.(); };
  const sel = PACKS.find((p) => p.id === selectedId) || null;
  const total = sel ? sel.coins + sel.bonus : 0;
  const myReward = chosen != null ? cards[chosen] : null;

  const startMystery = () => { if (!sel) return; setCards(pick3()); setChosen(null); setRevealed(false); setShowOthers(false); setStage("mystery"); };
  const onRevealed = () => { setRevealed(true); setTimeout(() => setShowOthers(true), 1100); };

  return (
    <div data-testid="get-coins-modal" className="rv-overlay" style={{ "--v-gold": gold, "--v-felt": felt }}>
      <div className={`rv-modal ${stage === "confirm" ? "rv-modal--confirm" : ""}`}>
        <span className="rv-sheen" aria-hidden="true" />
        <span className="rv-innerglow" aria-hidden="true" />
        <span className="rv-corner rv-corner--tl" aria-hidden="true" /><span className="rv-corner rv-corner--tr" aria-hidden="true" />
        <span className="rv-corner rv-corner--bl" aria-hidden="true" /><span className="rv-corner rv-corner--br" aria-hidden="true" />
        <span className="rv-spark rv-spark--1" aria-hidden="true" /><span className="rv-spark rv-spark--2" aria-hidden="true" /><span className="rv-spark rv-spark--3" aria-hidden="true" />

        <button data-testid="get-coins-close" onClick={close} aria-label="Close" className="rv-close">
          <X className="h-4 w-4" strokeWidth={2.5} />
        </button>

        <div className="rv-header">
          <div className="rv-brand"><Crown className="rv-brand__crown" fill="currentColor" strokeWidth={1.6} /> R11</div>
          <h2 className="rv-title">{stage === "mystery" ? "ROYAL MYSTERY BONUS" : "ROYAL COIN VAULT"}</h2>
          <p className="rv-sub">{stage === "mystery" ? "Choose one card and scratch to reveal your preview bonus" : "Choose your virtual coin preview"}</p>
          <span data-testid="get-coins-demo-badge" className="rv-badge"><Sparkles className="h-3 w-3" /> DEMO · VISUAL PREVIEW</span>
        </div>

        {stage === "select" && (
          <>
            <div className="rv-cards" data-testid="get-coins-packs">
              {PACKS.map((p) => {
                const on = selectedId === p.id;
                return (
                  <button key={p.id} type="button" data-testid={`get-coins-pack-${p.coins}`} aria-pressed={on}
                    onClick={() => setSelectedId(p.id)}
                    className={`rv-card ${p.featured ? "rv-card--featured" : ""} ${on ? "rv-card--selected" : ""}`}>
                    <span className={`rv-card__badge rv-card__badge--${p.tier}`}
                      data-testid={p.tier === "royal" ? "get-coins-best-value" : undefined}>{p.badge}</span>
                    <CoinArt tier={p.tier} />
                    <b className="rv-card__coins">{fmt(p.coins)}</b>
                    <span className="rv-card__coinslbl">Coins</span>
                    <span className="rv-card__bonus">+{fmt(p.bonus)} Preview Coins</span>
                    {on && <span className="rv-card__check" data-testid={`get-coins-pack-${p.coins}-check`}><Check className="h-3.5 w-3.5" strokeWidth={3.5} /></span>}
                  </button>
                );
              })}
            </div>
            <div className="rv-strip">Preview bonus included · Virtual coins only · No cash value</div>
            <div className="rv-actions">
              <button data-testid="get-coins-cancel" onClick={close} className="rv-btn rv-btn--ghost">Cancel</button>
              <button data-testid="get-coins-preview" onClick={startMystery} disabled={!sel} className="rv-btn rv-btn--primary">
                {sel ? `PREVIEW ${fmt(total)} COINS` : "SELECT A PACK"}
              </button>
            </div>
          </>
        )}

        {stage === "mystery" && (
          <div className="rv-mystery" data-testid="get-coins-mystery">
            <div className="rv-myrow">
              {cards.map((rw, i) => {
                const isChosen = chosen === i;
                const dim = chosen != null && !isChosen && !showOthers;
                const faceUp = (isChosen && revealed) || (!isChosen && showOthers);
                return (
                  <div key={rw.id} data-testid={`mystery-card-${i}`}
                    className={`rv-mycard ${isChosen ? "rv-mycard--active" : ""} ${dim ? "rv-mycard--dim" : ""} ${faceUp ? "rv-mycard--up" : ""} ${!isChosen && showOthers ? "rv-mycard--minor" : ""}`}
                    onClick={() => { if (chosen == null) setChosen(i); }}>
                    {faceUp ? (
                      <RewardFace rw={rw} muted={!isChosen} />
                    ) : isChosen ? (
                      <>
                        <RewardFace rw={rw} />
                        <ScratchFoil onDone={onRevealed} />
                      </>
                    ) : (
                      <span className="rv-myback" aria-hidden="true">
                        <span className="rv-myback__frame" />
                        <Crown className="rv-myback__crown" fill="currentColor" strokeWidth={1.4} />
                        <span className="rv-myback__r11">R11</span>
                      </span>
                    )}
                    {isChosen && revealed && <span className="rv-myburst" aria-hidden="true">{Array.from({ length: 6 }).map((_, k) => <i key={k} style={{ "--k": k }} />)}</span>}
                  </div>
                );
              })}
            </div>
            {revealed && myReward && (
              <p className="rv-mystery__result" data-testid="mystery-reward">You revealed <b>{myReward.label}</b> <span>· preview only</span></p>
            )}
            <div className="rv-actions rv-actions--mystery">
              <button data-testid="mystery-back" onClick={() => setStage("select")} className="rv-btn rv-btn--ghost">Back</button>
              <button data-testid="mystery-continue" onClick={() => setStage("confirm")} disabled={!revealed} className="rv-btn rv-btn--primary">Continue</button>
            </div>
          </div>
        )}

        {stage === "confirm" && (
          <div className="rv-confirm" data-testid="get-coins-confirm">
            <span className="rv-shower" aria-hidden="true">{Array.from({ length: 9 }).map((_, i) => <i key={i} style={{ "--i": i }} />)}</span>
            <span className="rv-emblem" aria-hidden="true"><Crown className="rv-emblem__crown" fill="currentColor" strokeWidth={1.4} /><span className="rv-emblem__ring" /></span>
            <h3 className="rv-confirm__title">ROYAL PREVIEW READY</h3>
            <p className="rv-confirm__amount">{fmt(total)} virtual coins shown in this preview</p>
            {myReward && <p className="rv-confirm__bonus" data-testid="confirm-mystery-line">Mystery bonus: <b>{myReward.label}</b> <span>(preview)</span></p>}
            <p className="rv-confirm__disc">Demo only — no real coins were credited and no payment was taken.</p>
            <button data-testid="get-coins-done" onClick={close} className="rv-btn rv-btn--primary rv-btn--wide">DONE</button>
          </div>
        )}
      </div>
    </div>
  );
}
