import { useState } from "react";
import { Coins, Crown, Gift, Palette, Shirt, Sparkles, Ticket, Check, X, Trophy, ListChecks } from "lucide-react";
import "./royal-vault.css";

// ---------------------------------------------------------------------------
// FRONTEND-ONLY coin flow (no real ledger movement — the server stays the sole
// authority over balances). Covers: Royal Win (acknowledge-only) and
// Redeem Coins → Redeem Confirmation → Redeem Successful. Redeem exchanges
// virtual coins for IN-APP rewards only (themes / outfits / avatars / effects /
// bonus entries). This is NOT a withdrawal — the label is always "Redeem Coins".
// ---------------------------------------------------------------------------

const Backdrop = ({ children, testid }) => (
  <div data-testid={testid} className="fixed inset-0 z-[130] grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
    <div className="w-full max-w-sm rounded-3xl border border-[var(--r-gold,#e9c667)]/40 bg-[#160a0c] p-6 text-center shadow-2xl">
      {children}
    </div>
  </div>
);

// ---- Royal Win (premium, acknowledge-only — NEVER credits coins) -----------
export const ClaimWinModal = ({ open, amount = 0, rows = [], reason = "", gold = "#e9c667", felt = "#5c1018", onClose }) => {
  const [ack, setAck] = useState(false);
  const [details, setDetails] = useState(false);
  if (!open) return null;
  const close = () => { setAck(false); setDetails(false); onClose?.(); };

  return (
    <div data-testid="royal-win-modal" className="rv-overlay" style={{ "--v-gold": gold, "--v-felt": felt }}>
      <div className="rv-modal rv-modal--win">
        <span className="rv-sheen" aria-hidden="true" />
        <span className="rv-innerglow" aria-hidden="true" />
        <span className="rv-corner rv-corner--tl" aria-hidden="true" /><span className="rv-corner rv-corner--tr" aria-hidden="true" />
        <span className="rv-corner rv-corner--bl" aria-hidden="true" /><span className="rv-corner rv-corner--br" aria-hidden="true" />
        {/* tasteful fireworks preview */}
        <span className="rw-fw" aria-hidden="true">{Array.from({ length: 5 }).map((_, i) => <b key={i} style={{ "--n": i }}>{Array.from({ length: 8 }).map((_, k) => <i key={k} style={{ "--k": k }} />)}</b>)}</span>

        <div className="rv-header">
          <div className="rv-brand"><Crown className="rv-brand__crown" fill="currentColor" strokeWidth={1.6} /> R11</div>
          <span className="rv-emblem rw-emblem" aria-hidden="true"><Trophy className="rv-emblem__crown" strokeWidth={1.5} /><span className="rv-emblem__ring" /></span>
          <h2 className="rv-title rw-title">ROYAL WIN</h2>
          <p className="rv-sub">{reason || "You won this round"}</p>
        </div>

        <div className="rw-amount" data-testid="royal-win-amount">
          <Coins className="h-6 w-6" strokeWidth={2.2} />
          <span>+{Number(amount).toLocaleString("en-IN")}</span>
          <small>virtual coins won</small>
        </div>
        <p className="rw-settled" data-testid="royal-win-settled">Winnings are already added by the game settlement.</p>

        {details && (
          <div className="rw-details" data-testid="royal-win-details">
            {rows.length ? rows.map((r, i) => (
              <div key={i} className={`rw-row ${r.isYou ? "rw-row--you" : ""}`}>
                <span className="rw-row__name">{r.name}{r.isYou ? " (You)" : ""}</span>
                {r.points != null && <span className="rw-row__pts">{r.points} pts</span>}
                <span className={`rw-row__delta ${r.delta >= 0 ? "pos" : "neg"}`}>{r.delta >= 0 ? "+" : ""}{Number(r.delta).toLocaleString("en-IN")}</span>
              </div>
            )) : <p className="rw-row__name">Result details unavailable.</p>}
          </div>
        )}

        <div className="rw-ack">
          {!ack ? (
            <button data-testid="claim-win-btn" onClick={() => setAck(true)} className="rv-btn rv-btn--primary rv-btn--wide">
              <Check className="mr-1 inline h-4 w-4" strokeWidth={3} /> CLAIM
            </button>
          ) : (
            <div data-testid="claim-ack" className="rw-ackdone"><Check className="h-4 w-4" strokeWidth={3} /> Win acknowledged · no coins added again</div>
          )}
        </div>

        <div className="rv-actions rw-actions">
          <button data-testid="win-details-toggle" onClick={() => setDetails((d) => !d)} className="rv-btn rv-btn--ghost">
            <ListChecks className="mr-1 inline h-4 w-4" /> {details ? "Hide Details" : "View Groups / Result"}
          </button>
          <button data-testid="win-continue" onClick={close} className="rv-btn rv-btn--primary">Continue</button>
        </div>
      </div>
    </div>
  );
};

// ---- Redeem Coins ----------------------------------------------------------
const ICON_BY_CAT = { theme: Palette, outfit: Shirt, avatar: Sparkles, effect: Gift, bonus_entry: Ticket };
const FALLBACK_REWARDS = [
  { id: "theme_royal", name: "Royal Theme Pack", cost: 5000, category: "theme" },
  { id: "outfit_host", name: "Host Wardrobe", cost: 8000, category: "outfit" },
  { id: "avatar_gold", name: "Gold Avatar Frame", cost: 3000, category: "avatar" },
  { id: "effect_fire", name: "Win Effect: Fireworks", cost: 4000, category: "effect" },
  { id: "entry_bonus5", name: "5x Bonus Entries", cost: 10000, category: "bonus_entry" },
];

export const RedeemCoinsModal = ({ open, balance = 0, rewards, onRedeem, onClose }) => {
  const [step, setStep] = useState("list"); // list | confirm | success
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!open) return null;
  const list = (rewards && rewards.length ? rewards : FALLBACK_REWARDS);
  const close = () => { setStep("list"); setSel(null); setErr(""); onClose(); };

  const doRedeem = async () => {
    setBusy(true); setErr("");
    try {
      if (onRedeem) await onRedeem(sel.id);
      setStep("success");
    } catch (e) {
      const code = e?.response?.data?.detail?.code;
      setErr(code === "INSUFFICIENT_COINS" ? "Not enough coins for this reward." : "Redeem failed. Please try again.");
      setStep("list");
    } finally { setBusy(false); }
  };

  if (step === "success") {
    return (
      <Backdrop testid="redeem-success">
        <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-emerald-500/20"><Check className="h-8 w-8 text-emerald-400" /></div>
        <h3 className="font-display text-2xl font-black text-white">Redeem Successful</h3>
        <p className="mt-2 text-sm text-white/60"><b className="text-[var(--r-gold,#e9c667)]">{sel?.name}</b> is now unlocked in your account.</p>
        <p className="mt-1 text-xs text-white/40">In-app reward · no cash value.</p>
        <button data-testid="redeem-close" onClick={close}
          className="mt-5 w-full rounded-2xl bg-[var(--r-gold,#e9c667)] py-3 text-sm font-black text-black">Done</button>
      </Backdrop>
    );
  }

  if (step === "confirm" && sel) {
    const Icon = ICON_BY_CAT[sel.category] || Gift;
    return (
      <Backdrop testid="redeem-confirmation">
        <h3 className="font-display text-xl font-black text-white">Redeem Confirmation</h3>
        <div className="mx-auto my-4 grid h-14 w-14 place-items-center rounded-2xl bg-[var(--r-gold,#e9c667)]/15"><Icon className="h-7 w-7 text-[var(--r-gold,#e9c667)]" /></div>
        <p className="text-sm text-white/80">Redeem <b className="text-[var(--r-gold,#e9c667)]">{sel.cost.toLocaleString("en-IN")}</b> coins for</p>
        <p className="text-base font-black text-white">{sel.name}?</p>
        <p className="mt-2 text-xs text-white/40">Coins are exchanged for an in-app reward only. This is not a cash withdrawal and cannot be reversed.</p>
        <div className="mt-5 flex gap-2">
          <button data-testid="redeem-cancel" disabled={busy} onClick={() => setStep("list")} className="flex-1 rounded-2xl border border-white/15 py-3 text-sm font-bold text-white/70 hover:bg-white/5 disabled:opacity-50">Back</button>
          <button data-testid="redeem-confirm-yes" disabled={busy} onClick={doRedeem} className="flex-1 rounded-2xl bg-emerald-500 py-3 text-sm font-black text-black disabled:opacity-50">{busy ? "Redeeming…" : "Confirm Redeem"}</button>
        </div>
      </Backdrop>
    );
  }

  return (
    <Backdrop testid="redeem-modal">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-xl font-black text-[var(--r-gold,#e9c667)]">Redeem Coins</h3>
        <button data-testid="redeem-x" onClick={close} className="grid h-8 w-8 place-items-center rounded-full text-white/50 hover:bg-white/10"><X className="h-4 w-4" /></button>
      </div>
      <p className="mt-1 flex items-center justify-center gap-1.5 text-xs text-white/50"><Coins className="h-3.5 w-3.5 text-[var(--r-gold,#e9c667)]" /> Balance: <b className="text-white">{balance.toLocaleString("en-IN")}</b></p>
      <p className="mb-2 mt-1 text-[11px] text-white/40">Exchange coins for in-app rewards — never cash. No withdrawals.</p>
      {err && <p data-testid="redeem-error" className="mb-2 rounded-xl bg-rose-500/15 py-2 text-xs font-bold text-rose-300">{err}</p>}
      <div className="space-y-2 text-left">
        {list.map((r) => {
          const afford = balance >= r.cost;
          const Icon = ICON_BY_CAT[r.category] || Gift;
          return (
            <button key={r.id} data-testid={`redeem-item-${r.id}`} disabled={!afford}
              onClick={() => { setSel(r); setErr(""); setStep("confirm"); }}
              className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${afford ? "border-white/10 hover:border-[var(--r-gold,#e9c667)]/50 hover:bg-white/[0.04]" : "border-white/5 opacity-40"}`}>
              <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-[var(--r-gold,#e9c667)]/15"><Icon className="h-5 w-5 text-[var(--r-gold,#e9c667)]" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-white">{r.name}</span>
                <span className="block truncate text-[11px] text-white/50 capitalize">{(r.category || "").replace("_", " ")}</span>
              </span>
              <span className="flex flex-none items-center gap-1 text-sm font-black text-[var(--r-gold,#e9c667)]"><Coins className="h-3.5 w-3.5" />{r.cost.toLocaleString("en-IN")}</span>
            </button>
          );
        })}
      </div>
    </Backdrop>
  );
};
