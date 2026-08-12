import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, Lock, User as UserIcon, ArrowRight, Loader2, ShieldCheck, Gift, KeyRound } from "lucide-react";
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

// Branded header for a per-Admin login page. Shows the Admin's logo (if any)
// and falls back gracefully to the ROYAL11 crest when no logo is set.
const BrandedHeader = ({ branding }) => {
  const logoUrl = branding.has_logo
    ? `${process.env.REACT_APP_BACKEND_URL}/api/public/branding/${branding.brand_slug}/logo`
    : null;
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-center gap-3"
      data-testid="branded-login-header"
    >
      {logoUrl ? (
        <div className="h-16 w-16 overflow-hidden rounded-2xl ring-1 ring-slate-200 shadow-soft">
          <img src={logoUrl} alt={branding.brand_name} className="h-full w-full object-cover" draggable={false} data-testid="branded-login-logo" />
        </div>
      ) : (
        <Logo compact />
      )}
    </motion.div>
  );
};

export default function AuthPage({ branding = null }) {
  const { login, register, verifyOtp, resendOtp } = useAuth();
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [otpEmail, setOtpEmail] = useState(""); // when set, show the OTP step
  const [otpCode, setOtpCode] = useState("");
  const [resending, setResending] = useState(false);

  const isSignup = mode === "signup";

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (isSignup) {
        const res = await register(email.trim(), password, displayName.trim(), referralCode.trim().toUpperCase());
        if (res?.requires_verification) {
          setOtpEmail(email.trim().toLowerCase());
          setOtpCode("");
          toast.success("Check your email", { description: "We sent a 6-digit code to verify your account." });
        }
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

  const submitOtp = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await verifyOtp(otpEmail, otpCode.trim());
      toast.success("Welcome to ROYAL11!", { description: "1,000 bonus coins added to your wallet." });
      // isAuthenticated flips -> routes redirect to the app automatically.
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setResending(true);
    setError("");
    try {
      await resendOtp(otpEmail);
      toast.success("Code resent", { description: "Check your inbox for a fresh code." });
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setResending(false);
    }
  };

  const backToSignup = () => { setOtpEmail(""); setOtpCode(""); setError(""); };

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
          {branding ? (
            <BrandedHeader branding={branding} />
          ) : (
            <Logo />
          )}
          <h1 className="mt-6 font-display text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            {otpEmail ? "Verify your email" : isSignup ? "Create your account" : branding ? `Welcome to ${branding.brand_name}` : "Welcome back"}
          </h1>
          <p className="mt-2 text-sm font-medium text-slate-500">
            {otpEmail
              ? <>Enter the 6-digit code we sent to <span className="font-semibold text-slate-700">{otpEmail}</span></>
              : isSignup ? "Join the game — get 1,000 bonus coins." : "Log in to play, win & manage your coins."}
          </p>
        </div>

        {otpEmail ? (
          <form onSubmit={submitOtp} className="space-y-3.5" data-testid="otp-form">
            <Field
              icon={KeyRound}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="6-digit code"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
              data-testid="otp-code-input"
            />
            {error && (
              <p data-testid="otp-error" className="rounded-xl bg-[#FEE2E2] px-4 py-3 text-sm font-semibold text-[#DC2626]">{error}</p>
            )}
            <button
              type="submit"
              disabled={busy || otpCode.length !== 6}
              data-testid="otp-submit-btn"
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-royal py-4 text-sm font-bold text-white shadow-lift transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {busy ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <>Verify &amp; continue <ArrowRight className="h-4 w-4" /></>}
            </button>
            <div className="flex items-center justify-between pt-1 text-xs font-semibold">
              <button type="button" onClick={backToSignup} data-testid="otp-back-btn" className="text-slate-500 hover:text-slate-800">← Back</button>
              <button type="button" onClick={resend} disabled={resending} data-testid="otp-resend-btn" className="text-royal hover:underline disabled:opacity-60">
                {resending ? "Sending…" : "Resend code"}
              </button>
            </div>
          </form>
        ) : (
        <>
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
        </>
        )}

        <p className="mt-6 flex items-center justify-center gap-2 text-center text-xs font-medium text-slate-400">
          <ShieldCheck className="h-4 w-4" />
          Virtual entertainment coins only — no real-money value.
        </p>
      </motion.div>
    </div>
  );
}
