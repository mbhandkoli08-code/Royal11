import { useRef, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useScroll, useTransform } from "framer-motion";
import { Bell, Coins, Wallet, Plus, ChevronRight, Flame, Radio, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useWallet } from "@/context/WalletContext";
import { Reveal, MaskedLines } from "@/components/Reveal";
import { TeamBuilder } from "@/components/TeamBuilder";
import { USER, QUICK_ACTIONS, LIVE_MATCHES, GAMES, FANTASY_PROMO_BG } from "@/lib/data";

const fmt = (n) => n.toLocaleString("en-IN");

const SectionHead = ({ title, action, testid }) => (
  <div className="mb-4 flex items-end justify-between">
    <h2 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{title}</h2>
    {action && (
      <button
        data-testid={testid}
        onClick={() => toast("Coming soon", { description: `${title} — full view` })}
        className="flex items-center gap-1 text-sm font-semibold text-royal transition-opacity hover:opacity-70"
      >
        {action} <ChevronRight className="h-4 w-4" />
      </button>
    )}
  </div>
);

const LiveCard = ({ m }) => (
  <div
    data-testid={`live-match-${m.id}`}
    className="group relative w-[300px] shrink-0 snap-start overflow-hidden rounded-3xl bg-slate-900 shadow-soft sm:w-[340px]"
  >
    <div
      className="h-32 bg-cover bg-center opacity-70 transition-transform duration-700 group-hover:scale-110"
      style={{ backgroundImage: `url(${m.image})` }}
    />
    <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4">
      <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
        {m.league}
      </span>
      <span className="flex items-center gap-1.5 rounded-full bg-red-500 px-2.5 py-1 text-[11px] font-bold text-white">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-white" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
        </span>
        LIVE
      </span>
    </div>
    <div className="p-5">
      <p className="mb-3 text-xs font-semibold text-slate-400">{m.sport}</p>
      <div className="space-y-2.5">
        {[m.teamA, m.teamB].map((t, i) => (
          <div key={i} className="flex items-center justify-between">
            <span className="text-base font-bold text-white">{t.name}</span>
            <motion.span
              key={t.score}
              initial={{ opacity: 0, y: -10, scale: 1.15 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 22 }}
              className="font-display text-lg font-bold text-white"
            >
              {t.score}
              {t.ov && <span className="ml-1 text-xs font-medium text-slate-400">({t.ov})</span>}
            </motion.span>
          </div>
        ))}
      </div>
      <p className="mt-4 rounded-xl bg-white/10 px-3 py-2 text-xs font-medium text-amber-300">{m.note}</p>
    </div>
  </div>
);

export default function HomePage() {
  const navigate = useNavigate();
  const { balance, todayEarned, streakClaimed, claimStreak, earnCoins } = useWallet();
  const promoRef = useRef(null);
  const { scrollYProgress } = useScroll({ target: promoRef, offset: ["start end", "end start"] });
  const promoY = useTransform(scrollYProgress, [0, 1], ["-12%", "12%"]);

  const [matches, setMatches] = useState(LIVE_MATCHES);
  const [builderOpen, setBuilderOpen] = useState(false);

  useEffect(() => {
    const chaseTarget = 219;
    const iv = setInterval(() => {
      setMatches((prev) =>
        prev.map((m) => {
          if (m.id === "cric") {
            let [runs, wkts] = m.teamA.score.split("/").map(Number);
            let [ov, ball] = m.teamA.ov.split(".").map(Number);
            ball += 1;
            if (ball > 5) { ball = 0; ov += 1; }
            const delta = [0, 1, 1, 0, 2, 4, 6, 1][Math.floor(Math.random() * 8)];
            runs += delta;
            if (Math.random() < 0.05 && wkts < 9) wkts += 1;
            const need = Math.max(chaseTarget - runs, 0);
            const ballsLeft = Math.max((20 - ov) * 6 - ball, 0);
            const note = need === 0 ? "MI won by 6 wickets 🎉" : ballsLeft === 0 ? "Innings over" : `MI need ${need} off ${ballsLeft}`;
            return { ...m, teamA: { ...m.teamA, score: `${runs}/${wkts}`, ov: `${ov}.${ball}` }, note };
          }
          if (m.id === "foot" && Math.random() < 0.12) {
            const a = Number(m.teamA.score), b = Number(m.teamB.score);
            return Math.random() < 0.5
              ? { ...m, teamA: { ...m.teamA, score: String(a + 1) }, note: "GOAL! " + m.note }
              : { ...m, teamB: { ...m.teamB, score: String(b + 1) }, note: "GOAL! " + m.note };
          }
          return m;
        })
      );
    }, 2600);
    return () => clearInterval(iv);
  }, []);

  const handleEarn = () => {
    earnCoins();
    toast.success("+100 coins earned!", { description: "Added to your wallet." });
  };
  const handleClaim = () => {
    if (streakClaimed) return;
    claimStreak();
    toast.success("Streak claimed · +50 coins", { description: "Come back tomorrow for Day 6!" });
  };

  return (
    <div className="mx-auto max-w-6xl px-5 pb-28 pt-6 sm:px-8 lg:px-10">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <MaskedLines
            lines={[
              <span className="text-sm font-medium text-slate-500">Good evening,</span>,
              <span className="font-display text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
                {USER.name} 👋
              </span>,
            ]}
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            data-testid="notification-btn"
            onClick={() => toast("No new notifications")}
            className="relative grid h-11 w-11 place-items-center rounded-2xl bg-white text-slate-600 shadow-soft transition-transform hover:-translate-y-0.5"
          >
            <Bell className="h-5 w-5" />
            <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-flame ring-2 ring-white" />
          </button>
          <button data-testid="profile-avatar" className="h-11 w-11 overflow-hidden rounded-2xl ring-2 ring-white shadow-soft">
            <img src={USER.avatar} alt="avatar" className="h-full w-full object-cover" />
          </button>
        </div>
      </header>

      {/* Balance + Quick actions (bento) */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Balance card */}
        <Reveal className="lg:col-span-7">
          <div className="relative overflow-hidden rounded-3xl bg-royal p-7 text-white shadow-lift sm:p-8">
            <div className="grain pointer-events-none absolute inset-0 opacity-[0.15]" />
            <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-flame/40 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-20 -left-10 h-52 w-52 rounded-full bg-indigo-400/40 blur-3xl" />
            <div className="relative">
              <div className="flex items-center gap-2 text-sm font-medium text-indigo-100">
                <Coins className="h-4 w-4" /> Total Coin Balance
              </div>
              <div className="mt-3 flex items-end gap-3">
                <motion.span
                  key={balance}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="font-display text-5xl font-extrabold tracking-tight sm:text-6xl"
                  data-testid="home-balance"
                >
                  {fmt(balance)}
                </motion.span>
                <span className="mb-2 rounded-full bg-mint/25 px-3 py-1 text-xs font-bold text-emerald-50 ring-1 ring-white/20">
                  +{fmt(todayEarned)} today
                </span>
              </div>
              <div className="mt-7 flex flex-wrap gap-3">
                <button
                  data-testid="view-wallet-btn"
                  onClick={() => navigate("/wallet")}
                  className="flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-royal transition-transform hover:-translate-y-0.5"
                >
                  <Wallet className="h-4 w-4" /> View Wallet
                </button>
                <button
                  data-testid="earn-coins-btn"
                  onClick={handleEarn}
                  className="flex items-center gap-2 rounded-2xl bg-flame px-5 py-3 text-sm font-bold text-white transition-transform hover:-translate-y-0.5"
                >
                  <Plus className="h-4 w-4" /> Earn Coins
                </button>
              </div>
            </div>
          </div>
        </Reveal>

        {/* Quick actions */}
        <Reveal delay={0.1} className="lg:col-span-5">
          <div className="h-full rounded-3xl bg-white p-6 shadow-soft">
            <p className="mb-4 text-sm font-bold text-slate-900">Quick Actions</p>
            <div className="grid grid-cols-4 gap-3">
              {QUICK_ACTIONS.map((a) => {
                const Icon = a.icon;
                return (
                  <button
                    key={a.key}
                    data-testid={`quick-${a.key}`}
                    onClick={() => toast(`${a.label}`, { description: "Opening soon" })}
                    className="group flex flex-col items-center gap-2"
                  >
                    <span className={`grid h-14 w-14 place-items-center rounded-2xl ${a.tint} transition-transform group-hover:-translate-y-1`}>
                      <Icon className="h-6 w-6" strokeWidth={2.2} />
                    </span>
                    <span className="text-xs font-semibold text-slate-600">{a.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </Reveal>
      </div>

      {/* Live Now */}
      <section className="mt-12">
        <SectionHead title="Live Now" action="See all" testid="live-see-all" />
        <div className="no-scrollbar -mx-5 flex snap-x gap-4 overflow-x-auto px-5 pb-2 sm:mx-0 sm:px-0">
          {matches.map((m) => (
            <LiveCard key={m.id} m={m} />
          ))}
        </div>
      </section>

      {/* Fantasy promo */}
      <section className="mt-12" ref={promoRef}>
        <Reveal>
          <div className="relative h-56 overflow-hidden rounded-3xl shadow-soft sm:h-64">
            <motion.div
              style={{ y: promoY, backgroundImage: `url(${FANTASY_PROMO_BG})` }}
              className="absolute inset-0 -top-[12%] h-[124%] bg-cover bg-center"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-royal-dark/95 via-royal/80 to-royal/30" />
            <div className="relative flex h-full flex-col justify-center p-7 sm:p-10">
              <span className="mb-3 w-fit rounded-full bg-flame px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
                Mega Contest
              </span>
              <h3 className="max-w-md font-display text-2xl font-extrabold leading-tight text-white sm:text-3xl">
                ₹0 entry · Win 1,00,000 coins
              </h3>
              <p className="mt-1 text-sm text-indigo-100">IPL Grand League · 42,180 players joined</p>
              <button
                data-testid="fantasy-join-btn"
                onClick={() => setBuilderOpen(true)}
                className="mt-5 w-fit rounded-2xl bg-white px-6 py-3 text-sm font-bold text-royal transition-transform hover:-translate-y-0.5"
              >
                Join Contest
              </button>
            </div>
          </div>
        </Reveal>
      </section>

      {/* Games lobby */}
      <section className="mt-12">
        <SectionHead title="Games Lobby" action="All games" testid="games-see-all" />
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
          {GAMES.map((g, i) => {
            const Icon = g.icon;
            return (
              <Reveal key={g.key} delay={i * 0.05}>
                <button
                  data-testid={`game-${g.key}`}
                  onClick={() => toast(`${g.name}`, { description: "Table loading…" })}
                  className="group flex w-full flex-col items-center gap-3 rounded-3xl bg-white p-4 shadow-soft transition-transform hover:-translate-y-1"
                >
                  <span className={`grid h-14 w-14 place-items-center rounded-2xl ${g.tint} transition-transform group-hover:scale-105`}>
                    <Icon className="h-7 w-7" strokeWidth={2} />
                  </span>
                  <span className="text-center text-xs font-semibold text-slate-700">{g.name}</span>
                </button>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* Daily streak */}
      <section className="mt-12">
        <Reveal>
          <div className="flex flex-col items-start justify-between gap-5 rounded-3xl bg-white p-6 shadow-soft sm:flex-row sm:items-center">
            <div className="flex items-center gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-flame-light text-flame">
                <Flame className="h-7 w-7" />
              </span>
              <div>
                <p className="text-base font-bold text-slate-900">Daily Login Streak</p>
                <div className="mt-2 flex gap-1.5">
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                    <span
                      key={d}
                      className={`grid h-7 w-7 place-items-center rounded-lg text-[11px] font-bold ${
                        d <= 5 ? "bg-flame text-white" : "bg-slate-100 text-slate-400"
                      }`}
                    >
                      {d}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-500">Day 5 — claim your reward!</p>
              </div>
            </div>
            <button
              data-testid="claim-streak-btn"
              onClick={handleClaim}
              disabled={streakClaimed}
              className={`flex items-center gap-2 rounded-2xl px-6 py-3 text-sm font-bold transition-transform ${
                streakClaimed
                  ? "cursor-not-allowed bg-slate-100 text-slate-400"
                  : "bg-royal text-white hover:-translate-y-0.5"
              }`}
            >
              <Sparkles className="h-4 w-4" /> {streakClaimed ? "Claimed" : "Claim +50"}
            </button>
          </div>
        </Reveal>
      </section>

      <TeamBuilder open={builderOpen} onClose={() => setBuilderOpen(false)} />
    </div>
  );
}
