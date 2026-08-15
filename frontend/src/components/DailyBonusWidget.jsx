import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Gift, Loader2, Check, Crown } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Daily Bonus HUD (server-authoritative). The claimable state, amount, the
// 7-day streak ladder and the next-claim time all come from the server; the
// countdown is derived from the server clock (skew-corrected) so it can't be
// spoofed. Day 7 pays a bigger jackpot, then the ladder loops back to Day 1.
export const DailyBonusWidget = ({ className = "", onClaimed }) => {
  const { token } = useAuth();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const skewRef = useRef(0); // clientNow - serverNow (ms)

  const headers = { headers: { Authorization: `Bearer ${token}` } };

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/daily-bonus/status`, headers);
      setStatus(data);
      if (data.server_time) skewRef.current = Date.now() - new Date(data.server_time).getTime();
    } catch { /* silent — HUD is non-blocking */ }
  }, [token]);

  useEffect(() => { if (token) load(); }, [token, load]);

  // Tick the countdown once per second off the server-corrected clock.
  useEffect(() => {
    if (!status?.next_claim_at) return;
    const target = new Date(status.next_claim_at).getTime();
    const tick = () => {
      const serverNow = Date.now() - skewRef.current;
      const secs = Math.max(0, Math.round((target - serverNow) / 1000));
      setRemaining(secs);
      if (secs === 0 && !status.claimable) load(); // window rolled over → refresh
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status]);

  const claim = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/daily-bonus/claim`, {}, headers);
      setStatus(data);
      const jackpot = data.streak_day === data.streak_len;
      toast.success(jackpot ? `Day ${data.streak_len} Jackpot!` : "Daily bonus claimed!",
        { description: `+${data.amount} bonus coins` });
      onClaimed?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Couldn't claim bonus");
      load();
    } finally { setBusy(false); }
  };

  if (!status || !status.enabled) return null;

  const hh = String(Math.floor(remaining / 3600)).padStart(2, "0");
  const mm = String(Math.floor((remaining % 3600) / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  const len = status.streak_len || 7;
  const cur = status.streak_day || 1;
  const isJackpotDay = cur === len;

  // Render the 7-day streak ladder. A day is "done" when it's before the
  // current day, or the current day once already claimed today.
  const dots = Array.from({ length: len }, (_, i) => {
    const day = i + 1;
    const done = day < cur || (day === cur && status.claimed_today);
    const active = day === cur && status.claimable;
    const isSeven = day === len;
    return { day, done, active, isSeven };
  });

  return (
    <div data-testid="daily-bonus-widget"
      className={`w-48 rounded-2xl border border-[var(--r-gold,#c9a227)]/50 bg-black/70 p-3 text-center shadow-2xl backdrop-blur-md ${className}`}>
      <div className="flex items-center justify-center gap-1.5">
        <Gift className="h-4 w-4 text-[var(--r-gold,#c9a227)]" />
        <span className="text-[11px] font-black uppercase tracking-widest text-[var(--r-gold,#c9a227)]">Daily Bonus</span>
      </div>

      {/* 7-day streak ladder */}
      <div data-testid="daily-bonus-streak" className="mt-2 flex items-center justify-center gap-[3px]">
        {dots.map(({ day, done, active, isSeven }) => (
          <div key={day} data-testid={`streak-day-${day}`}
            className={[
              "relative grid h-[22px] w-[22px] place-items-center rounded-md text-[9px] font-black transition-colors",
              isSeven ? "h-[24px] w-[24px]" : "",
              done ? "bg-[var(--r-gold,#c9a227)] text-black"
                : active ? (isSeven ? "bg-amber-400/20 text-amber-200 ring-2 ring-amber-300 animate-pulse"
                                    : "bg-white/10 text-white ring-2 ring-[var(--r-gold,#c9a227)] animate-pulse")
                  : "bg-white/5 text-white/40",
            ].join(" ")}
            title={isSeven ? `Day ${day} • +${status.day7_amount} jackpot` : `Day ${day} • +${status.base_amount}`}>
            {isSeven ? <Crown className={`h-3 w-3 ${done ? "text-black" : "text-amber-300"}`} />
              : done ? <Check className="h-3 w-3" /> : day}
          </div>
        ))}
      </div>

      {status.claimable ? (
        <>
          <p className="mt-2 text-[11px] text-white/70" data-testid="daily-bonus-amount">
            {isJackpotDay ? <span className="font-black text-amber-300">Day {len} Jackpot · +{status.amount}</span>
              : <>Day {cur} · +{status.amount} coins</>}
          </p>
          <button data-testid="daily-bonus-claim" onClick={claim} disabled={busy}
            className="mt-2 w-full rounded-xl bg-[var(--r-gold,#c9a227)] py-2 text-xs font-black text-black transition-transform hover:-translate-y-0.5 disabled:opacity-50">
            {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "CLAIM"}
          </button>
        </>
      ) : (
        <>
          <p className="mt-2 flex items-center justify-center gap-1 text-[11px] text-emerald-300"><Check className="h-3 w-3" /> Day {cur} claimed</p>
          <p data-testid="daily-bonus-countdown" className="mt-1 font-mono text-lg font-bold tracking-wider text-white/90">{hh}:{mm}:{ss}</p>
          <p className="text-[9px] uppercase tracking-widest text-white/40">next bonus</p>
        </>
      )}
    </div>
  );
};
