import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X, Copy, Check, Gift, Users, Loader2, Share2, Sparkles, Ticket } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Player "Refer & Earn": shows the code + share link, WhatsApp / copy / native
// share, reward amounts, a promo-code redeem box, and a "My Referrals" list.
export const ReferAndEarn = ({ open, onClose }) => {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [promo, setPromo] = useState("");
  const [promoBusy, setPromoBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/referrals/me`, { headers: { Authorization: `Bearer ${token}` } });
      setData(data);
    } catch { toast.error("Couldn't load referrals"); }
    setLoading(false);
  }, [token]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const applyPromo = async () => {
    const code = promo.trim();
    if (!code) return;
    setPromoBusy(true);
    try {
      const { data: res } = await axios.post(`${API}/promo/apply`, { code },
        { headers: { Authorization: `Bearer ${token}` } });
      toast.success("Promo applied!", { description: `+${res.bonus_coins} bonus coins` });
      setPromo("");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Couldn't apply promo code");
    } finally { setPromoBusy(false); }
  };

  if (!open) return null;

  const code = data?.code || "";
  const link = code ? `${window.location.origin}/auth?ref=${code}` : "";
  const cfg = data?.config || {};
  const shareText = `Join me on ROYAL11 and get ${cfg.referee_amount || 0} bonus coins! Use my code ${code} 🎮 ${link}`;

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1600); toast.success("Link copied"); }
    catch { toast.error("Copy failed"); }
  };
  const whatsapp = () => window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, "_blank");
  const nativeShare = async () => {
    if (navigator.share) { try { await navigator.share({ title: "ROYAL11", text: shareText, url: link }); } catch { /* cancelled */ } }
    else copy();
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center" data-testid="refer-earn">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:h-auto sm:max-h-[85vh] sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-royal-light text-royal"><Gift className="h-5 w-5" /></span>
            <h2 data-testid="refer-heading" className="font-display text-lg font-bold text-slate-900">Refer &amp; Earn{data?.config?.referrer_amount ? ` ${data.config.referrer_amount} Coins` : ""}</h2>
          </div>
          <button data-testid="refer-close" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading || !data ? (
            <div className="flex justify-center py-16 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <>
              {/* Hero — Independence "freedom" theme */}
              <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-royal to-flame p-5 text-white">
                <div className="absolute inset-x-0 top-0 h-1" style={{ background: "linear-gradient(90deg,#FF9933 0 33%,#ffffff 33% 66%,#138808 66% 100%)" }} />
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-white/80">Freedom to Play</p>
                <p className="mt-0.5 text-sm font-semibold text-white/90">Refer &amp; unlock more freedom to play — you both get bonus coins! 🇮🇳</p>
                <div className="mt-3 flex items-end gap-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-white/70">You get</p>
                    <p className="font-display text-3xl font-extrabold">{cfg.referrer_amount}</p>
                  </div>
                  <div className="h-10 w-px bg-white/30" />
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-white/70">They get</p>
                    <p className="font-display text-3xl font-extrabold">{cfg.referee_amount}</p>
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-white/70">Bonus coins (playthrough applies). {cfg.qualify_event === "SIGNUP" ? "Credited when they sign up." : cfg.qualify_event === "FIRST_WAGER" ? "Your reward unlocks after their first game." : "Your reward unlocks after their first recharge."}</p>
              </div>

              {/* Code + link */}
              <div className="mt-5">
                <p className="mb-1.5 text-xs font-semibold text-slate-600">Your referral code</p>
                <div className="flex items-center justify-between rounded-2xl border-2 border-dashed border-slate-200 px-4 py-3">
                  <span data-testid="refer-code" className="font-display text-2xl font-extrabold tracking-[0.2em] text-slate-900">{code}</span>
                  <button data-testid="refer-copy" onClick={copy} className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3.5 py-2 text-xs font-bold text-white">
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy link"}
                  </button>
                </div>
              </div>

              {/* Share buttons */}
              <div className="mt-3 grid grid-cols-2 gap-3">
                <button data-testid="refer-whatsapp" onClick={whatsapp} className="flex items-center justify-center gap-2 rounded-2xl bg-[#25D366] py-3 text-sm font-bold text-white">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.6.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.5-.7-2.5-1.3-3.5-3-.3-.5.3-.4.7-1.3.1-.2 0-.4 0-.5 0-.1-.6-1.5-.9-2.1-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.3-.9.9-.9 2.1s.9 2.5 1 2.6c.1.2 1.8 2.7 4.3 3.8 1.6.7 2.2.7 3 .6.5-.1 1.7-.7 1.9-1.3.2-.7.2-1.2.2-1.3-.1-.2-.3-.2-.6-.3z"/><path d="M12 2a10 10 0 0 0-8.5 15.3L2 22l4.8-1.5A10 10 0 1 0 12 2zm0 18a8 8 0 0 1-4.1-1.1l-.3-.2-2.9.9.9-2.8-.2-.3A8 8 0 1 1 12 20z"/></svg>
                  WhatsApp
                </button>
                <button data-testid="refer-share" onClick={nativeShare} className="flex items-center justify-center gap-2 rounded-2xl bg-royal py-3 text-sm font-bold text-white">
                  <Share2 className="h-4 w-4" /> Share
                </button>
              </div>

              {/* Stats */}
              <div className="mt-5 grid grid-cols-3 gap-3">
                <div className="rounded-2xl bg-slate-50 p-3 text-center">
                  <p className="font-display text-xl font-extrabold text-slate-900">{data.stats.joined}</p>
                  <p className="text-[11px] text-slate-500">Joined</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3 text-center">
                  <p className="font-display text-xl font-extrabold text-slate-900">{data.stats.qualified}</p>
                  <p className="text-[11px] text-slate-500">Rewarded</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3 text-center">
                  <p className="font-display text-xl font-extrabold text-royal">{data.stats.total_earned}</p>
                  <p className="text-[11px] text-slate-500">Coins earned</p>
                </div>
              </div>

              {/* Milestone nudge */}
              {(() => {
                const joined = data.stats.joined;
                const nextMilestone = Math.max(1, Math.ceil((joined + 1) / 5) * 5);
                const remaining = nextMilestone - joined;
                return (
                  <div data-testid="refer-nudge" className="mt-3 flex items-center gap-2 rounded-2xl bg-flame/10 px-3.5 py-2.5">
                    <Sparkles className="h-4 w-4 text-flame" />
                    <p className="text-xs font-semibold text-slate-700">
                      {remaining === 1 ? "Just 1 more friend" : `${remaining} more friends`} to reach {nextMilestone} referrals — keep the freedom rolling!
                    </p>
                  </div>
                );
              })()}

              {/* My referrals */}
              <div className="mt-5">
                <p className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-900"><Users className="h-4 w-4" /> My referrals</p>
                {data.referrals.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 py-8 text-center">
                    <p className="text-sm font-semibold text-slate-500">No referrals yet</p>
                    <p className="mt-1 text-xs text-slate-400">Share your code above — you both earn bonus coins when a friend joins &amp; recharges.</p>
                  </div>
                ) : data.referrals.map((r, i) => {
                  const rewarded = r.status === "REWARDED";
                  const label = rewarded ? `Recharged · Bonus earned +${r.referrer_reward}` : "Joined · pending recharge";
                  return (
                    <div key={i} data-testid={`refer-row-${i}`} className="mb-2 flex items-center justify-between rounded-2xl border border-slate-100 px-3.5 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-extrabold ${rewarded ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                          {(r.referee_name || "P").slice(0, 2).toUpperCase()}
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{r.referee_name}</p>
                          <p className={`text-[11px] font-medium ${rewarded ? "text-emerald-600" : "text-amber-600"}`}>{label}</p>
                        </div>
                      </div>
                      {rewarded && <span className="text-xs font-bold text-emerald-600">+{r.referrer_reward}</span>}
                    </div>
                  );
                })}
              </div>

              {/* Promo code redemption */}
              <div className="mt-5" data-testid="promo-section">
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600"><Ticket className="h-4 w-4" /> Have a promo code?</p>
                <div className="flex items-center gap-2">
                  <input data-testid="promo-input" value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())}
                    placeholder="Enter promo code"
                    className="min-w-0 flex-1 rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-sm font-semibold uppercase tracking-wider text-slate-900 outline-none focus:border-royal/40" />
                  <button data-testid="promo-apply" onClick={applyPromo} disabled={promoBusy || !promo.trim()}
                    className="shrink-0 rounded-2xl bg-royal px-5 py-3 text-sm font-bold text-white disabled:opacity-50">
                    {promoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
                  </button>
                </div>
              </div>

              {/* Virtual-coin disclaimer (baked into the design) */}
              <p data-testid="rewards-disclaimer" className="mt-5 text-center text-[11px] font-medium text-slate-400">
                Virtual coins only · No cash value · No withdrawal or redemption
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
