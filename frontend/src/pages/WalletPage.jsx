import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ChevronLeft, TrendingUp, TrendingDown, Award, HelpCircle, Gift,
  Users, Dice5, Sparkles, Trophy, Flame, ShieldCheck, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useWallet } from "@/context/WalletContext";
import { Reveal, MaskedLines } from "@/components/Reveal";
import { RewardsStore } from "@/components/RewardsStore";

const fmt = (n) => n.toLocaleString("en-IN");

const ICONS = { Gift, Users, Dice5, Sparkles, Trophy, Flame };

export default function WalletPage() {
  const navigate = useNavigate();
  const { balance, txns, rewardsClaimed, boostUntil, extendBoost } = useWallet();
  const [storeOpen, setStoreOpen] = useState(false);

  const [now, setNow] = useState(Date.now());
  const boostActive = boostUntil && now < boostUntil;
  const boostLeft = boostActive ? Math.ceil((boostUntil - now) / 1000) : 0;
  useEffect(() => {
    if (!boostUntil) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [boostUntil]);

  const earnedWeek = 1250;
  const spentWeek = 480;

  const stats = [
    { label: "Earned this week", value: `+${fmt(earnedWeek)}`, icon: TrendingUp, tint: "bg-mint-light text-mint", testid: "stat-earned" },
    { label: "Spent this week", value: `-${fmt(spentWeek)}`, icon: TrendingDown, tint: "bg-flame-light text-flame", testid: "stat-spent" },
    { label: "Rewards claimed", value: fmt(rewardsClaimed), icon: Award, tint: "bg-royal-light text-royal", testid: "stat-rewards" },
  ];

  return (
    <div className="mx-auto max-w-3xl px-5 pb-28 pt-6 sm:px-8">
      {/* Header */}
      <header className="flex items-center gap-3">
        <button
          data-testid="wallet-back-btn"
          onClick={() => navigate("/")}
          className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-slate-700 shadow-soft transition-transform hover:-translate-y-0.5"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-slate-900">Wallet</h1>
      </header>

      {/* Balance */}
      <Reveal className="mt-8">
        <div className="relative overflow-hidden rounded-3xl bg-royal p-8 text-white shadow-lift">
          <div className="grain pointer-events-none absolute inset-0 opacity-[0.15]" />
          <div className="pointer-events-none absolute -right-14 -top-14 h-52 w-52 rounded-full bg-flame/40 blur-3xl" />
          <div className="relative">
            <p className="text-sm font-medium text-indigo-100">Total Balance</p>
            <MaskedLines
              className="mt-2"
              lines={[
                <span data-testid="wallet-balance" className="font-display text-6xl font-extrabold tracking-tight sm:text-7xl">
                  {fmt(balance)}
                </span>,
              ]}
            />
            <p className="mt-1 text-sm font-semibold text-indigo-100">coins</p>
            {boostActive && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span data-testid="wallet-boost-pill" className="inline-flex items-center gap-1.5 rounded-full bg-flame px-3 py-1.5 text-xs font-bold text-white ring-1 ring-white/20">
                  <Zap className="h-3.5 w-3.5" /> 2x Coins active · {Math.floor(boostLeft / 60)}:{String(boostLeft % 60).padStart(2, "0")}
                </span>
                <button
                  data-testid="wallet-boost-extend-btn"
                  onClick={() => {
                    const r = extendBoost(60, 100);
                    if (r === "insufficient") toast.error("Not enough coins to extend");
                    else if (r === "success") toast.success("2x boost extended +60s ⚡");
                  }}
                  className="inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-1.5 text-xs font-bold text-white ring-1 ring-white/20 transition-colors hover:bg-white/30"
                >
                  <Sparkles className="h-3.5 w-3.5" /> Extend +60s · 100
                </button>
              </div>
            )}
            <p className="mt-5 flex items-start gap-2 rounded-2xl bg-white/10 p-3 text-xs leading-relaxed text-indigo-50">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              Virtual entertainment coins only — no real-money value, not withdrawable or redeemable for cash.
            </p>
          </div>
        </div>
      </Reveal>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-3 gap-3 sm:gap-4">
        {stats.map((s, i) => {
          const Icon = s.icon;
          return (
            <Reveal key={s.testid} delay={i * 0.08}>
              <div data-testid={s.testid} className="rounded-3xl bg-white p-4 shadow-soft sm:p-5">
                <span className={`grid h-10 w-10 place-items-center rounded-xl ${s.tint}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <p className="mt-3 font-display text-lg font-extrabold tracking-tight text-slate-900 sm:text-xl">{s.value}</p>
                <p className="text-[11px] font-medium leading-tight text-slate-500 sm:text-xs">{s.label}</p>
              </div>
            </Reveal>
          );
        })}
      </div>

      {/* Actions */}
      <Reveal className="mt-6">
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <button
            data-testid="how-to-earn-btn"
            onClick={() => toast("How to Earn", { description: "Play games, refer friends & log in daily." })}
            className="flex items-center justify-center gap-2 rounded-2xl border-2 border-royal/15 bg-white px-5 py-4 text-sm font-bold text-royal transition-transform hover:-translate-y-0.5"
          >
            <HelpCircle className="h-4 w-4" /> How to Earn
          </button>
          <button
            data-testid="redeem-btn"
            onClick={() => setStoreOpen(true)}
            className="flex items-center justify-center gap-2 rounded-2xl bg-flame px-5 py-4 text-sm font-bold text-white transition-transform hover:-translate-y-0.5"
          >
            <Gift className="h-4 w-4" /> Redeem
          </button>
        </div>
      </Reveal>

      {/* Transactions */}
      <section className="mt-10">
        <h2 className="mb-4 text-xl font-bold tracking-tight text-slate-900">Transaction History</h2>
        <div className="overflow-hidden rounded-3xl bg-white shadow-soft" data-testid="txn-list">
          {txns.map((t, i) => {
            const Icon = ICONS[t.icon] || Sparkles;
            const credit = t.type === "credit";
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.05, 0.4) }}
                data-testid={`txn-${t.id}`}
                className={`flex items-center gap-4 px-5 py-4 ${i !== txns.length - 1 ? "border-b border-slate-100" : ""}`}
              >
                <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${credit ? "bg-mint-light text-mint" : "bg-flame-light text-flame"}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-900">{t.label}</p>
                  <p className="truncate text-xs text-slate-500">{t.meta} · {t.when}</p>
                </div>
                <span className={`font-display text-sm font-extrabold ${credit ? "text-mint" : "text-slate-800"}`}>
                  {credit ? "+" : "−"}{fmt(t.amount)}
                </span>
              </motion.div>
            );
          })}
        </div>
      </section>

      <RewardsStore open={storeOpen} onClose={() => setStoreOpen(false)} />
    </div>
  );
}
