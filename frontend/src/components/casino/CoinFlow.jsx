import { useState } from "react";
import { Coins, Crown, Gift, Palette, Shirt, Sparkles, Ticket, Check, X } from "lucide-react";

// ---------------------------------------------------------------------------
// FRONTEND-ONLY coin flow (no real ledger movement — the server stays the sole
// authority over balances). Covers: Claim Win → Claim Successful and
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

// ---- Claim Win -------------------------------------------------------------
export const ClaimWinModal = ({ open, amount = 0, onClaim, onClose }) => {
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const doClaim = async () => {
    setBusy(true);
    try { if (onClaim) await onClaim(); setDone(true); }
    finally { setBusy(false); }
  };
  if (done) {
    return (
      <Backdrop testid="claim-success">
        <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-emerald-500/20"><Check className="h-8 w-8 text-emerald-400" /></div>
        <h3 className="font-display text-2xl font-black text-white">Claim Successful</h3>
        <p className="mt-2 text-sm text-white/60">Your winnings of {amount.toLocaleString("en-IN")} were credited to your balance.</p>
        <button data-testid="claim-close" onClick={() => { setDone(false); onClose(); }}
          className="mt-5 w-full rounded-2xl bg-[var(--r-gold,#e9c667)] py-3 text-sm font-black text-black">Done</button>
      </Backdrop>
    );
  }
  return (
    <Backdrop testid="claim-win-modal">
      <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-[var(--r-gold,#e9c667)]/20"><Crown className="h-8 w-8 text-[var(--r-gold,#e9c667)]" /></div>
      <h3 className="font-display text-2xl font-black text-[var(--r-gold,#e9c667)]">Win Result</h3>
      <p className="mt-1 text-sm text-white/60">You won this hand!</p>
      <p className="mt-3 flex items-center justify-center gap-2 text-4xl font-black text-white"><Coins className="h-7 w-7 text-[var(--r-gold,#e9c667)]" />+{amount.toLocaleString("en-IN")}</p>
      <button data-testid="claim-win-btn" onClick={doClaim} disabled={busy}
        className="mt-5 w-full rounded-2xl bg-emerald-500 py-3 text-sm font-black text-black transition-transform hover:scale-[1.02] disabled:opacity-50">{busy ? "Claiming…" : "Claim Win"}</button>
      <button data-testid="claim-later" onClick={onClose} className="mt-2 w-full py-2 text-xs font-bold text-white/40 hover:text-white/70">Maybe later</button>
    </Backdrop>
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
