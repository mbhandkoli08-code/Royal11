import { useState } from "react";
import { X, Check, Crown, Sparkles, Coins } from "lucide-react";
import "./royal-vault.css";

// VISUAL-ONLY "ROYAL COIN VAULT". Shows virtual coin *preview* packs with demo
// bonuses. Does NOT credit/debit coins, never calls the wallet/backend, and
// never shows money, currency, payment, UPI, QR or bank details. The real
// deposit feature (AddCoins) remains separate and unchanged.

const PACKS = [
  { id: "starter", coins: 1000, bonus: 100, badge: "STARTER", tier: "starter" },
  { id: "popular", coins: 5000, bonus: 750, badge: "MOST POPULAR", tier: "popular", featured: true },
  { id: "royal", coins: 10000, bonus: 2000, badge: "BEST VALUE", tier: "royal" },
];

const fmt = (n) => n.toLocaleString("en-IN");

// Small gold coin-art built from CSS (stays gold in every theme, matches the
// R11 identity). Tier controls the treatment (stack vs. crowned chest).
function CoinArt({ tier }) {
  if (tier === "royal") {
    return (
      <span className="rv-art rv-art--chest" aria-hidden="true">
        <Crown className="rv-art__crown" strokeWidth={2.1} />
        <span className="rv-coin rv-coin--a" />
        <span className="rv-coin rv-coin--b" />
        <span className="rv-coin rv-coin--c" />
      </span>
    );
  }
  return (
    <span className={`rv-art rv-art--${tier}`} aria-hidden="true">
      {tier === "popular" && <Sparkles className="rv-art__spark" />}
      <span className="rv-coin rv-coin--a" />
      <span className="rv-coin rv-coin--b" />
      {tier === "popular" && <span className="rv-coin rv-coin--c" />}
      <Coins className="rv-art__ico" strokeWidth={2} />
    </span>
  );
}

export function GetCoinsDemo({ open, onClose, gold = "#e9c667", felt = "#5c1018" }) {
  const [selectedId, setSelectedId] = useState(null);
  const [confirmed, setConfirmed] = useState(null);
  if (!open) return null;

  const close = () => { setSelectedId(null); setConfirmed(null); onClose?.(); };
  const sel = PACKS.find((p) => p.id === selectedId) || null;
  const total = sel ? sel.coins + sel.bonus : 0;

  return (
    <div data-testid="get-coins-modal" className="rv-overlay"
      style={{ "--v-gold": gold, "--v-felt": felt }}>
      <div className={`rv-modal ${confirmed ? "rv-modal--confirm" : ""}`}>
        {/* layered depth: velvet sheen, inner gold glow, corner flourishes */}
        <span className="rv-sheen" aria-hidden="true" />
        <span className="rv-innerglow" aria-hidden="true" />
        <span className="rv-corner rv-corner--tl" aria-hidden="true" />
        <span className="rv-corner rv-corner--tr" aria-hidden="true" />
        <span className="rv-corner rv-corner--bl" aria-hidden="true" />
        <span className="rv-corner rv-corner--br" aria-hidden="true" />
        <span className="rv-spark rv-spark--1" aria-hidden="true" />
        <span className="rv-spark rv-spark--2" aria-hidden="true" />
        <span className="rv-spark rv-spark--3" aria-hidden="true" />

        <button data-testid="get-coins-close" onClick={close} aria-label="Close" className="rv-close">
          <X className="h-4 w-4" strokeWidth={2.5} />
        </button>

        {/* Header */}
        <div className="rv-header">
          <div className="rv-brand"><Crown className="rv-brand__crown" fill="currentColor" strokeWidth={1.6} /> R11</div>
          <h2 className="rv-title">ROYAL COIN VAULT</h2>
          <p className="rv-sub">Choose your virtual coin preview</p>
          <span data-testid="get-coins-demo-badge" className="rv-badge">
            <Sparkles className="h-3 w-3" /> DEMO · VISUAL PREVIEW
          </span>
        </div>

        {!confirmed ? (
          <>
            <div className="rv-cards" data-testid="get-coins-packs">
              {PACKS.map((p) => {
                const on = selectedId === p.id;
                return (
                  <button key={p.id} type="button"
                    data-testid={`get-coins-pack-${p.coins}`}
                    aria-pressed={on}
                    onClick={() => setSelectedId(p.id)}
                    className={`rv-card ${p.featured ? "rv-card--featured" : ""} ${on ? "rv-card--selected" : ""}`}>
                    <span className={`rv-card__badge rv-card__badge--${p.tier}`}
                      data-testid={p.tier === "royal" ? "get-coins-best-value" : undefined}>{p.badge}</span>
                    <CoinArt tier={p.tier} />
                    <b className="rv-card__coins">{fmt(p.coins)}</b>
                    <span className="rv-card__coinslbl">Coins</span>
                    <span className="rv-card__bonus">+{fmt(p.bonus)} Preview Coins</span>
                    {on && (
                      <span className="rv-card__check" data-testid={`get-coins-pack-${p.coins}-check`}>
                        <Check className="h-3.5 w-3.5" strokeWidth={3.5} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="rv-strip">Preview bonus included · Virtual coins only · No cash value</div>

            <div className="rv-actions">
              <button data-testid="get-coins-cancel" onClick={close} className="rv-btn rv-btn--ghost">Cancel</button>
              <button data-testid="get-coins-preview" onClick={() => sel && setConfirmed(sel)} disabled={!sel}
                className="rv-btn rv-btn--primary">
                {sel ? `PREVIEW ${fmt(total)} COINS` : "SELECT A PACK"}
              </button>
            </div>
          </>
        ) : (
          <div className="rv-confirm" data-testid="get-coins-confirm">
            <span className="rv-shower" aria-hidden="true">
              {Array.from({ length: 9 }).map((_, i) => <i key={i} style={{ "--i": i }} />)}
            </span>
            <span className="rv-emblem" aria-hidden="true">
              <Crown className="rv-emblem__crown" fill="currentColor" strokeWidth={1.4} />
              <span className="rv-emblem__ring" />
            </span>
            <h3 className="rv-confirm__title">ROYAL PREVIEW READY</h3>
            <p className="rv-confirm__amount">{fmt(confirmed.coins + confirmed.bonus)} virtual coins shown in this preview</p>
            <p className="rv-confirm__disc">Demo only — no real coins were credited and no payment was taken.</p>
            <button data-testid="get-coins-done" onClick={close} className="rv-btn rv-btn--primary rv-btn--wide">DONE</button>
          </div>
        )}
      </div>
    </div>
  );
}
