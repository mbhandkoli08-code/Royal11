import { motion } from "framer-motion";
import { ShieldCheck, QrCode, MessageCircle, Trophy, UserPlus, Users } from "lucide-react";
import "@/pages/login-hero.css";

const FEATURES = [
  { icon: ShieldCheck, text: "Server-Verified Results" },
  { icon: QrCode, text: "Secure UPI Payments" },
  { icon: MessageCircle, text: "24/7 WhatsApp Support" },
  { icon: Trophy, text: "Instant Fantasy Contests" },
];

const STEPS = [
  { icon: UserPlus, title: "Sign Up", sub: "Get 1,000 bonus coins" },
  { icon: Users, title: "Build Your Team", sub: "Pick your XI or deposit" },
  { icon: Trophy, title: "Play & Win", sub: "Climb the leaderboard" },
];

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.15 } },
};
const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
};

// Marketing / trust column shown beside the login form (bank-homepage style).
// Purely informational — no claims about features that aren't built.
export const LoginShowcase = () => (
  <motion.div
    variants={stagger}
    initial="hidden"
    animate="show"
    className="relative z-10 w-full max-w-lg text-center lg:text-left"
    data-testid="login-showcase"
  >
    {/* 3D coin hero */}
    <motion.div variants={item} className="mb-8 flex justify-center lg:justify-start">
      <div className="r11-coin-scene" data-testid="login-3d-coin" aria-hidden="true">
        <div className="r11-coin">
          <div className="r11-coin__face r11-coin__front">R11</div>
          <div className="r11-coin__face r11-coin__back">₹</div>
        </div>
      </div>
    </motion.div>

    <motion.h2 variants={item} className="font-display text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
      Play sports. Win coins. <span className="text-royal">Fair & square.</span>
    </motion.h2>
    <motion.p variants={item} className="mt-2 text-sm font-medium text-slate-500">
      India's all-in-one fantasy &amp; casual gaming arena — every result is verified on our servers.
    </motion.p>

    {/* Trust / feature tiles */}
    <motion.div variants={item} className="mt-7 grid grid-cols-2 gap-3" data-testid="login-features">
      {FEATURES.map((f) => (
        <div key={f.text} className="flex items-center gap-3 rounded-2xl border border-slate-200/70 bg-white/70 p-3 text-left backdrop-blur-sm">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-royal/10 text-royal">
            <f.icon className="h-[18px] w-[18px]" />
          </span>
          <span className="text-xs font-bold text-slate-700">{f.text}</span>
        </div>
      ))}
    </motion.div>

    {/* How it works */}
    <motion.div variants={item} className="mt-7" data-testid="login-how-it-works">
      <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">How it works</p>
      <div className="flex items-stretch gap-2">
        {STEPS.map((s, i) => (
          <div key={s.title} className="flex flex-1 items-center gap-2">
            <div className="flex-1 rounded-2xl bg-white/70 p-3 text-center backdrop-blur-sm ring-1 ring-slate-200/70">
              <span className="mx-auto mb-1.5 grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-flame to-royal text-white">
                <s.icon className="h-[18px] w-[18px]" />
              </span>
              <p className="text-xs font-extrabold text-slate-800">{s.title}</p>
              <p className="mt-0.5 text-[10px] leading-tight text-slate-400">{s.sub}</p>
            </div>
            {i < STEPS.length - 1 && <span className="text-slate-300">›</span>}
          </div>
        ))}
      </div>
    </motion.div>
  </motion.div>
);
