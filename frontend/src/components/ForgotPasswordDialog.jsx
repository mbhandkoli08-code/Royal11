import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mail, KeyRound, Lock, Loader2, ArrowRight, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth, formatApiErrorDetail } from "@/context/AuthContext";

// Two-step "Forgot password" flow (email -> OTP + new password), reused by both
// the player (AuthPage) and staff (ConsoleLoginPage) login screens. The backend
// returns a generic message so this never reveals whether an email exists.
export const ForgotPasswordDialog = ({ open, onClose, initialEmail = "", onDone }) => {
  const { forgotPassword, resetPassword } = useAuth();
  const [step, setStep] = useState("request"); // request | reset
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setStep("request"); setEmail(initialEmail); setCode(""); setNewPassword("");
      setConfirm(""); setShow(false); setError("");
    }
  }, [open, initialEmail]);

  if (!open) return null;

  const requestCode = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const res = await forgotPassword(email.trim().toLowerCase());
      toast.success("Check your email", { description: res?.message });
      setStep("reset");
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally { setBusy(false); }
  };

  const doReset = async (e) => {
    e.preventDefault();
    setError("");
    if (newPassword !== confirm) { setError("Passwords do not match"); return; }
    if (newPassword.length < 8) { setError("Password must be at least 8 characters"); return; }
    setBusy(true);
    try {
      await resetPassword(email.trim().toLowerCase(), code.trim(), newPassword);
      toast.success("Password reset", { description: "Sign in with your new password." });
      onDone?.(email.trim().toLowerCase());
      onClose();
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally { setBusy(false); }
  };

  const inputCls = "w-full rounded-xl border-2 border-slate-100 bg-white py-3 pl-11 pr-11 text-sm font-medium text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-royal/40";

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4" data-testid="forgot-password-dialog">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
      >
        <button data-testid="forgot-close" onClick={onClose} className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        <h2 className="font-display text-xl font-bold text-slate-900">Reset your password</h2>
        <p className="mt-1 text-sm text-slate-500">
          {step === "request"
            ? "Enter your account email and we'll send a 6-digit code."
            : <>Enter the code sent to <span className="font-semibold text-slate-700">{email}</span> and choose a new password.</>}
        </p>

        <AnimatePresence mode="wait">
          {step === "request" ? (
            <motion.form key="req" onSubmit={requestCode} className="mt-5 space-y-3" data-testid="forgot-request-form">
              <div className="relative">
                <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input data-testid="forgot-email-input" type="email" required autoComplete="username" placeholder="Email address"
                  value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls.replace("pr-11", "pr-4")} />
              </div>
              {error && <p data-testid="forgot-error" className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-600">{error}</p>}
              <button type="submit" disabled={busy} data-testid="forgot-request-submit"
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-royal py-3.5 text-sm font-bold text-white transition-transform hover:-translate-y-0.5 disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Send reset code <ArrowRight className="h-4 w-4" /></>}
              </button>
            </motion.form>
          ) : (
            <motion.form key="reset" onSubmit={doReset} className="mt-5 space-y-3" data-testid="forgot-reset-form">
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input data-testid="forgot-code-input" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required placeholder="6-digit code"
                  value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} className={inputCls.replace("pr-11", "pr-4")} />
              </div>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input data-testid="forgot-newpass-input" type={show ? "text" : "password"} required minLength={8} autoComplete="new-password" placeholder="New password (min 8)"
                  value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={inputCls} />
                <button type="button" data-testid="forgot-newpass-toggle" onClick={() => setShow((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label={show ? "Hide password" : "Show password"}>
                  {show ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                </button>
              </div>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input data-testid="forgot-confirm-input" type={show ? "text" : "password"} required minLength={8} autoComplete="new-password" placeholder="Confirm new password"
                  value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputCls.replace("pr-11", "pr-4")} />
              </div>
              {error && <p data-testid="forgot-error" className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-600">{error}</p>}
              <button type="submit" disabled={busy} data-testid="forgot-reset-submit"
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-royal py-3.5 text-sm font-bold text-white transition-transform hover:-translate-y-0.5 disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Reset password <ShieldCheck className="h-4 w-4" /></>}
              </button>
              <button type="button" data-testid="forgot-back" onClick={() => { setStep("request"); setError(""); }} className="w-full text-center text-xs font-semibold text-slate-400 hover:text-slate-600">← Use a different email</button>
            </motion.form>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};
