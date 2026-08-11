import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, Lock, User as UserIcon, ArrowRight, Loader2, ShieldCheck, Gift } from "lucide-react";
import { toast } from "sonner";
import { useAuth, formatApiErrorDetail } from "@/context/AuthContext";
import { Logo } from "@/components/Logo";

const Field = ({ icon: Icon, ...props }) => (
  <div className="relative">
    <Icon className="pointer-events-none absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" />
    <input
      {...props}
      className="w-full rounded-2xl border-2 border-slate-100 bg-white py-3.5 pl-11 pr-4 text-sm font-medium text-slate-900 shadow-soft outline-none transition-colors placeholder:text-slate-400 focus:border-royal/40"
    />
  </div>
);

export default function AuthPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const isSignup = mode === "signup";

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (isSignup) {
        await register(email.trim(), password, displayName.trim(), referralCode.trim().toUpperCase());
        toast.success("Welcome to ROYAL11!", { description: "1,000 bonus coins added to your wallet." });
      } else {
        await login(email.trim(), password);
        toast.success("Welcome back!");
      }
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (m) => {
    setMode(m);
    setError("");
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-5 py-10">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-royal/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-flame/20 blur-3xl" />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-md"
        data-testid="auth-page"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo />
          <h1 className="mt-6 font-display text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            {isSignup ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-2 text-sm font-medium text-slate-500">
            {isSignup ? "Join the game — get 1,000 bonus coins." : "Log in to play, win & manage your coins."}
          </p>
        </div>

        {/* Mode toggle */}
        <div className="mb-6 grid grid-cols-2 gap-1.5 rounded-2xl bg-white p-1.5 shadow-soft">
          {[
            { key: "login", label: "Log In" },
            { key: "signup", label: "Sign Up" },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              data-testid={`auth-tab-${t.key}`}
              onClick={() => switchMode(t.key)}
              className={`relative rounded-xl py-2.5 text-sm font-bold transition-colors ${
                mode === t.key ? "text-white" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {mode === t.key && (
                <motion.span
                  layoutId="auth-pill"
                  className="absolute inset-0 rounded-xl bg-royal"
                  transition={{ type: "spring", stiffness: 400, damping: 34 }}
                />
              )}
              <span className="relative">{t.label}</span>
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-3.5" data-testid="auth-form">
          <AnimatePresence initial={false} mode="popLayout">
            {isSignup && (
              <motion.div
                key="name-field"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                <Field
                  icon={UserIcon}
                  type="text"
                  placeholder="Display name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  data-testid="auth-name-input"
                />
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence initial={false} mode="popLayout">
            {isSignup && (
              <motion.div
                key="referral-field"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                <Field
                  icon={Gift}
                  type="text"
                  placeholder="Referral code (optional)"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value)}
                  data-testid="auth-referral-input"
                />
              </motion.div>
            )}
          </AnimatePresence>

          <Field
            icon={Mail}
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            data-testid="auth-email-input"
          />
          <Field
            icon={Lock}
            type="password"
            placeholder={isSignup ? "Password (min 8 characters)" : "Password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={isSignup ? 8 : undefined}
            data-testid="auth-password-input"
          />

          {error && (
            <p data-testid="auth-error" className="rounded-xl bg-[#FEE2E2] px-4 py-3 text-sm font-semibold text-[#DC2626]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            data-testid="auth-submit-btn"
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-royal py-4 text-sm font-bold text-white shadow-lift transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {busy ? (
              <Loader2 className="h-4.5 w-4.5 animate-spin" />
            ) : (
              <>
                {isSignup ? "Create account" : "Log in"} <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>

        <p className="mt-6 flex items-center justify-center gap-2 text-center text-xs font-medium text-slate-400">
          <ShieldCheck className="h-4 w-4" />
          Virtual entertainment coins only — no real-money value.
        </p>
      </motion.div>
    </div>
  );
}
