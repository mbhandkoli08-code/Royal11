import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X, Loader2, Landmark, ShieldCheck, CheckCircle2, AlertCircle, QrCode, Upload, Trash2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UPI_RE = /^[\w.\-]{2,256}@[a-zA-Z]{2,64}$/;

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

const Input = ({ label, value, onChange, testid, placeholder, error, prefix, right, inputMode, maxLength }) => (
  <label className="block">
    <span className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</span>
    <div className={`flex items-center rounded-xl border bg-white transition-colors ${error ? "border-rose-300 focus-within:border-rose-400" : "border-slate-200 focus-within:border-royal"}`}>
      {prefix && <span className="pl-3.5 text-sm font-semibold text-slate-400">{prefix}</span>}
      <input data-testid={testid} value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        inputMode={inputMode} maxLength={maxLength}
        className="w-full bg-transparent px-3.5 py-2.5 text-sm outline-none" />
      {right && <span className="pr-3">{right}</span>}
    </div>
    {error && <span data-testid={`${testid}-error`} className="mt-1 flex items-center gap-1 text-xs text-rose-500"><AlertCircle className="h-3 w-3" /> {error}</span>}
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
  const [ifscLookup, setIfscLookup] = useState({ status: "idle", bank: "", branch: "" });
  const [qrUrl, setQrUrl] = useState(null);
  const [qrBusy, setQrBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await axios.get(`${API}/me/profile`, headers); setP(data); }
    catch { toast.error("Couldn't load profile"); }
    setLoading(false);
  }, [token]);

  useEffect(() => { if (open) load(); }, [open, load]);

  // Live IFSC lookup (Razorpay public API) — auto-fills bank name on a valid code.
  const ifsc = p?.bank?.ifsc || "";
  useEffect(() => {
    if (!open) return;
    if (!IFSC_RE.test(ifsc)) { setIfscLookup({ status: "idle", bank: "", branch: "" }); return; }
    let cancelled = false;
    setIfscLookup({ status: "loading", bank: "", branch: "" });
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`https://ifsc.razorpay.com/${ifsc}`);
        if (!res.ok) throw new Error("not found");
        const d = await res.json();
        if (cancelled) return;
        setIfscLookup({ status: "ok", bank: d.BANK || "", branch: d.BRANCH || "" });
        setP((prev) => (prev && !prev.bank?.bank_name ? { ...prev, bank: { ...(prev.bank || {}), bank_name: d.BANK || "" } } : prev));
      } catch {
        if (!cancelled) setIfscLookup({ status: "error", bank: "", branch: "" });
      }
    }, 450);
    return () => { cancelled = true; clearTimeout(t); };
  }, [ifsc, open]);

  // Fetch the player's own UPI QR (authenticated endpoint → load as blob URL).
  const hasQr = !!p?.has_upi_qr;
  useEffect(() => {
    if (!open || !hasQr) { setQrUrl(null); return; }
    let cancelled = false;
    let objUrl = null;
    (async () => {
      try {
        const res = await axios.get(`${API}/me/profile/upi-qr`, { ...headers, responseType: "blob" });
        if (cancelled) return;
        objUrl = URL.createObjectURL(res.data);
        setQrUrl(objUrl);
      } catch { if (!cancelled) setQrUrl(null); }
    })();
    return () => { cancelled = true; if (objUrl) URL.revokeObjectURL(objUrl); };
  }, [hasQr, open]);

  const uploadQr = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Please choose an image file");
    if (file.size > 5 * 1024 * 1024) return toast.error("Image too large (max 5MB)");
    setQrBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await axios.post(`${API}/me/profile/upi-qr`, fd, headers);
      setP(data); toast.success("QR uploaded");
    } catch (e) { toast.error(e.response?.data?.detail || "Couldn't upload QR"); }
    setQrBusy(false);
  };

  const removeQr = async () => {
    setQrBusy(true);
    try {
      const { data } = await axios.delete(`${API}/me/profile/upi-qr`, headers);
      setP(data); setQrUrl(null); toast.success("QR removed");
    } catch { toast.error("Couldn't remove QR"); }
    setQrBusy(false);
  };

  const setBank = (k, v) => setP({ ...p, bank: { ...(p.bank || {}), [k]: v } });
  const setConsent = (k, v) => {
    const consent = { ...(p.consent || {}), [k]: v };
    if (k === "marketing_opt_in" && !v) { consent.sms = false; consent.whatsapp = false; consent.push = false; }
    setP({ ...p, consent });
  };

  const mobile = p?.mobile || "";
  const upi = p?.upi_id || "";
  const mobileErr = mobile && !/^\d{10}$/.test(mobile) ? "Enter exactly 10 digits" : "";
  const ifscErr = ifsc && !IFSC_RE.test(ifsc) ? "Format: SBIN0000001" : (ifscLookup.status === "error" ? "IFSC not found — check the code" : "");
  const upiErr = upi && !UPI_RE.test(upi) ? "Format: username@bank" : "";
  const canSave = !mobileErr && !ifscErr && !upiErr && ifscLookup.status !== "loading";

  const save = async () => {
    if (!canSave) return;
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
                Your details are private and visible only to the platform&apos;s Super Admin for payout verification. Only you can edit them.
              </div>

              <Input label="Mobile number" testid="profile-mobile" value={mobile} prefix="+91" inputMode="numeric" maxLength={10}
                onChange={(v) => setP({ ...p, mobile: v.replace(/\D/g, "").slice(0, 10) })} placeholder="98765 43210" error={mobileErr} />

              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Payout — Bank</p>
                <div className="space-y-3">
                  <Input label="Account holder name" testid="profile-holder" value={p.bank?.account_holder_name} onChange={(v) => setBank("account_holder_name", v)} placeholder="As per bank" />
                  <Input label="Account number" testid="profile-acct" value={p.bank?.account_number} inputMode="numeric" onChange={(v) => setBank("account_number", v)} placeholder="Account number" />
                  <div className="grid grid-cols-2 gap-3">
                    <Input label="IFSC" testid="profile-ifsc" value={p.bank?.ifsc} maxLength={11}
                      onChange={(v) => setBank("ifsc", v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11))}
                      placeholder="SBIN0000001" error={ifscErr}
                      right={ifscLookup.status === "loading" ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : ifscLookup.status === "ok" ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : null} />
                    <Input label="Bank name" testid="profile-bank" value={p.bank?.bank_name} onChange={(v) => setBank("bank_name", v)} placeholder="Bank" />
                  </div>
                  {ifscLookup.status === "ok" && (ifscLookup.bank || ifscLookup.branch) && (
                    <p data-testid="profile-ifsc-branch" className="flex items-center gap-1 text-xs text-emerald-600">
                      <CheckCircle2 className="h-3 w-3" /> {ifscLookup.bank}{ifscLookup.branch ? ` · ${ifscLookup.branch}` : ""}
                    </p>
                  )}
                </div>
              </div>

              <Input label="UPI ID" testid="profile-upi" value={upi} onChange={(v) => setP({ ...p, upi_id: v.trim() })} placeholder="name@bank" error={upiErr} />

              <div data-testid="profile-upi-qr-section">
                <span className="mb-1.5 block text-xs font-semibold text-slate-600">UPI QR code <span className="font-normal text-slate-400">(optional)</span></span>
                <p className="mb-2 text-xs text-slate-400">Upload a screenshot of your UPI QR as an alternative record of your payment details. This is on-file only — it doesn&apos;t change how payouts work.</p>
                {qrUrl ? (
                  <div className="flex items-center gap-3 rounded-2xl border border-slate-200 p-3" data-testid="profile-upi-qr-preview">
                    <img src={qrUrl} alt="Your UPI QR" className="h-24 w-24 rounded-lg border border-slate-100 object-contain" />
                    <div className="flex flex-col gap-2">
                      <label data-testid="profile-upi-qr-replace" className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                        <Upload className="h-3.5 w-3.5" /> Replace
                        <input type="file" accept="image/*" className="hidden" disabled={qrBusy} onChange={(e) => uploadQr(e.target.files?.[0])} />
                      </label>
                      <button type="button" data-testid="profile-upi-qr-remove" onClick={removeQr} disabled={qrBusy}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                        <Trash2 className="h-3.5 w-3.5" /> Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <label data-testid="profile-upi-qr-upload"
                    className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-slate-200 py-6 text-slate-400 transition-colors hover:border-royal/40 hover:text-royal">
                    {qrBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <QrCode className="h-6 w-6" />}
                    <span className="text-xs font-semibold">{qrBusy ? "Uploading…" : "Tap to upload QR image"}</span>
                    <span className="text-[11px] text-slate-400">PNG or JPG, up to 5MB</span>
                    <input type="file" accept="image/*" className="hidden" disabled={qrBusy} onChange={(e) => uploadQr(e.target.files?.[0])} />
                  </label>
                )}
              </div>

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
            <button data-testid="profile-save" disabled={busy || !canSave} onClick={save}
              className="w-full rounded-2xl bg-royal py-3 text-sm font-bold text-white disabled:opacity-50">
              {busy ? "Saving…" : "Save details"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
