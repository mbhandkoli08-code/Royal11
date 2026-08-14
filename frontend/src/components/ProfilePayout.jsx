import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X, Loader2, Landmark, ShieldCheck } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const Toggle = ({ label, desc, checked, onChange, testid, disabled }) => (
  <button type="button" data-testid={testid} onClick={() => !disabled && onChange(!checked)} disabled={disabled}
    className={`flex w-full items-center justify-between rounded-2xl border p-3.5 text-left transition-colors ${disabled ? "opacity-50" : "hover:bg-slate-50"} ${checked ? "border-royal/40 bg-royal-light/40" : "border-slate-200"}`}>
    <div className="min-w-0 pr-3">
      <p className="text-sm font-bold text-slate-900">{label}</p>
      {desc && <p className="text-xs text-slate-500">{desc}</p>}
    </div>
    <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-royal" : "bg-slate-300"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${checked ? "translate-x-[22px]" : "translate-x-0.5"}`} />
    </span>
  </button>
);

const Input = ({ label, value, onChange, testid, placeholder }) => (
  <label className="block">
    <span className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</span>
    <input data-testid={testid} value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-royal" />
  </label>
);

// Player-owned Profile & Payout: contact, bank/UPI, and marketing consent. This
// is the single source of truth; only Super Admin can read it back (for payout
// verification / opted-in outreach). Consent is OFF by default (India DND).
export const ProfilePayout = ({ open, onClose }) => {
  const { token } = useAuth();
  const headers = { headers: { Authorization: `Bearer ${token}` } };
  const [p, setP] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await axios.get(`${API}/me/profile`, headers); setP(data); }
    catch { toast.error("Couldn't load profile"); }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const setBank = (k, v) => setP({ ...p, bank: { ...(p.bank || {}), [k]: v } });
  const setConsent = (k, v) => {
    const consent = { ...(p.consent || {}), [k]: v };
    if (k === "marketing_opt_in" && !v) { consent.sms = false; consent.whatsapp = false; consent.push = false; }
    setP({ ...p, consent });
  };

  const save = async () => {
    setBusy(true);
    try {
      const { data } = await axios.put(`${API}/me/profile`, {
        mobile: p.mobile, upi_id: p.upi_id, bank: p.bank, consent: p.consent,
      }, headers);
      setP(data); toast.success("Profile saved");
    } catch (e) { toast.error(e.response?.data?.detail || "Couldn't save"); }
    setBusy(false);
  };

  if (!open) return null;
  const optedIn = !!p?.consent?.marketing_opt_in;

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center" data-testid="profile-payout">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:h-[85vh] sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-royal-light text-royal"><Landmark className="h-5 w-5" /></span>
            <h2 className="font-display text-lg font-bold text-slate-900">Profile &amp; Payout</h2>
          </div>
          <button data-testid="profile-close" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading || !p ? (
            <div className="flex justify-center py-16 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-start gap-2 rounded-2xl bg-slate-50 p-3 text-xs text-slate-500">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-royal" />
                Your details are private and visible only to the platform's Super Admin for payout verification. Only you can edit them.
              </div>

              <Input label="Mobile number" testid="profile-mobile" value={p.mobile} onChange={(v) => setP({ ...p, mobile: v })} placeholder="+91 98765 43210" />

              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Payout — Bank</p>
                <div className="space-y-3">
                  <Input label="Account holder name" testid="profile-holder" value={p.bank?.account_holder_name} onChange={(v) => setBank("account_holder_name", v)} placeholder="As per bank" />
                  <Input label="Account number" testid="profile-acct" value={p.bank?.account_number} onChange={(v) => setBank("account_number", v)} placeholder="Account number" />
                  <div className="grid grid-cols-2 gap-3">
                    <Input label="IFSC" testid="profile-ifsc" value={p.bank?.ifsc} onChange={(v) => setBank("ifsc", v)} placeholder="HDFC0001234" />
                    <Input label="Bank name" testid="profile-bank" value={p.bank?.bank_name} onChange={(v) => setBank("bank_name", v)} placeholder="Bank" />
                  </div>
                </div>
              </div>

              <Input label="UPI ID" testid="profile-upi" value={p.upi_id} onChange={(v) => setP({ ...p, upi_id: v })} placeholder="name@bank" />

              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Promotional messages</p>
                <div className="space-y-2">
                  <Toggle label="Receive offers & promotions" desc="Off by default. You choose the channels below." testid="consent-optin" checked={optedIn} onChange={(v) => setConsent("marketing_opt_in", v)} />
                  <Toggle label="SMS" testid="consent-sms" checked={!!p.consent?.sms} disabled={!optedIn} onChange={(v) => setConsent("sms", v)} />
                  <Toggle label="WhatsApp" testid="consent-whatsapp" checked={!!p.consent?.whatsapp} disabled={!optedIn} onChange={(v) => setConsent("whatsapp", v)} />
                  <Toggle label="Push notifications" testid="consent-push" checked={!!p.consent?.push} disabled={!optedIn} onChange={(v) => setConsent("push", v)} />
                </div>
              </div>
            </div>
          )}
        </div>

        {p && (
          <div className="border-t border-slate-100 p-4">
            <button data-testid="profile-save" disabled={busy} onClick={save}
              className="w-full rounded-2xl bg-royal py-3 text-sm font-bold text-white disabled:opacity-50">
              {busy ? "Saving…" : "Save details"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
