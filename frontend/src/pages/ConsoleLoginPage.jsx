import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Crown, Mail, Lock, ArrowRight, Loader2, Users, Banknote, Scale, BarChart3, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth, formatApiErrorDetail } from "@/context/AuthContext";

const CONSOLE_ROLES = ["SUPER_ADMIN", "ZONAL_MANAGER", "MANAGER", "ADMIN", "SUPPORT_HELPER"];

const QUICK = [
  { icon: Users, label: "Team & Roles" },
  { icon: Banknote, label: "Deposits" },
  { icon: Scale, label: "Settlements" },
  { icon: BarChart3, label: "Reports" },
];

export default function ConsoleLoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const emailRef = useRef(null);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const user = await login(email.trim(), password);
      toast.success("Welcome back!");
      navigate(CONSOLE_ROLES.includes(user.role) ? "/console" : "/", { replace: true });
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 font-console" data-testid="console-login-page">
      {/* Gradient marketing header */}
      <div className="relative overflow-hidden bg-gradient-to-br from-orange-500 to-rose-600 pb-28 pt-6">
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-10 left-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />

        <div className="mx-auto flex max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/15 text-white backdrop-blur">
              <Crown className="h-5 w-5" />
            </span>
            <div className="leading-none text-white">
              <p className="font-display text-lg font-bold tracking-tight">ROYAL 11</p>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/70">Admin Platform</p>
            </div>
          </div>
          <span className="hidden items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur sm:inline-flex">
            <ShieldCheck className="h-3.5 w-3.5" /> Secure staff access
          </span>
        </div>

        <div className="mx-auto mt-12 max-w-5xl px-6">
          <motion.h1
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
            className="font-display text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl"
          >
            Run the ROYAL 11<br />coin economy.
          </motion.h1>
          <p className="mt-3 max-w-xl text-sm font-medium text-white/80">
            One console for managers, admins and super admins — allocations, deposits, settlements and more.
          </p>
        </div>
      </div>

      {/* Quick-access cards overlapping the fold */}
      <div className="mx-auto -mt-10 grid max-w-5xl grid-cols-2 gap-3 px-6 sm:grid-cols-4" data-testid="console-login-quick">
        {QUICK.map((q, i) => {
          const Icon = q.icon;
          return (
            <motion.button
              key={q.label}
              type="button"
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.06 }}
              onClick={() => emailRef.current?.focus()}
              className="flex flex-col items-start gap-3 rounded-2xl border border-slate-200/60 bg-white p-4 text-left shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] transition-transform duration-200 hover:-translate-y-[2px]"
            >
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-orange-500 to-rose-600 text-white">
                <Icon className="h-5 w-5" />
              </span>
              <span className="text-sm font-semibold text-slate-800">{q.label}</span>
            </motion.button>
          );
        })}
      </div>

      {/* Sign-in form */}
      <div className="mx-auto mt-10 max-w-md px-6 pb-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="rounded-2xl border border-slate-200/60 bg-white p-7 shadow-xl shadow-rose-500/10"
        >
          <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900">Sign in to your account</h2>
          <p className="mt-1 text-sm text-slate-500">Enter your staff credentials to continue.</p>

          <form onSubmit={submit} className="mt-6 space-y-3.5" data-testid="console-login-form">
            <div className="relative">
              <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                ref={emailRef}
                type="email" placeholder="Email address" value={email}
                onChange={(e) => setEmail(e.target.value)} required
                data-testid="auth-email-input"
                className="w-full rounded-xl border border-slate-200 bg-white py-3.5 pl-11 pr-4 text-sm font-medium text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              />
            </div>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="password" placeholder="Password" value={password}
                onChange={(e) => setPassword(e.target.value)} required
                data-testid="auth-password-input"
                className="w-full rounded-xl border border-slate-200 bg-white py-3.5 pl-11 pr-4 text-sm font-medium text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              />
            </div>

            {error && (
              <p data-testid="auth-error" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p>
            )}

            <button
              type="submit" disabled={busy} data-testid="auth-submit-btn"
              className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-br from-orange-500 to-rose-600 py-3.5 text-sm font-bold text-white shadow-lg shadow-rose-500/20 transition-transform hover:-translate-y-0.5 active:scale-[0.99] disabled:opacity-70"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Sign in <ArrowRight className="h-4 w-4" /></>}
            </button>
          </form>

          <button
            type="button" onClick={() => navigate("/")} data-testid="console-login-player-link"
            className="mt-4 w-full text-center text-xs font-semibold text-slate-400 transition-colors hover:text-slate-600"
          >
            Looking for the player app? Go to ROYAL11 →
          </button>
        </motion.div>
      </div>
    </div>
  );
}
