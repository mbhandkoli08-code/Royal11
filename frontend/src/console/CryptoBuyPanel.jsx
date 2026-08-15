import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Bitcoin, Copy, Check, Loader2, Upload, QrCode, Coins, Info } from "lucide-react";
import { useConsoleApi, fmtCoins, fmtDate } from "@/console/api";
import { PanelHeader, Field, PrimaryButton, Spinner, CARD, thCls, tdCls, StatusBadge } from "@/console/primitives";
import { AuthImage } from "@/console/AuthImage";

// ADMIN: buy coin allocation from the Super Admin by sending USDT (TRC-20) to
// the ONE static receiving address. Manual proof submit -> Super Admin verifies.
export const CryptoBuyPanel = () => {
  const api = useConsoleApi();
  const [cfg, setCfg] = useState(null);
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ usdt_amount: "", inr_equivalent: "", sender_wallet: "", tx_id: "" });
  const [file, setFile] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, p] = await Promise.all([
        api.get("/admin/crypto/config"),
        api.get("/admin/crypto/my-purchases"),
      ]);
      setCfg(c.data); setPurchases(p.data);
    } catch { toast.error("Couldn't load USDT purchase info"); } finally { setLoading(false); }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const coinPreview = useMemo(() => {
    const inr = Number(form.inr_equivalent);
    if (!cfg || !inr) return 0;
    return Math.round(inr * cfg.coin_rate);
  }, [form.inr_equivalent, cfg]);

  const copyAddr = () => {
    if (!cfg?.usdt_address) return;
    navigator.clipboard?.writeText(cfg.usdt_address);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  const submit = async () => {
    const usdt = Number(form.usdt_amount);
    const inr = Math.round(Number(form.inr_equivalent));
    if (!usdt || usdt <= 0) return toast.error("Enter the USDT amount you sent");
    if (!inr || inr < cfg.min_inr) return toast.error(`Minimum purchase is ₹${fmtCoins(cfg.min_inr)} INR-equivalent`);
    if (!form.tx_id.trim() && !file) return toast.error("Attach a transaction ID or a screenshot as proof");
    const fd = new FormData();
    fd.append("usdt_amount", usdt);
    fd.append("inr_equivalent", inr);
    if (form.sender_wallet.trim()) fd.append("sender_wallet", form.sender_wallet.trim());
    if (form.tx_id.trim()) fd.append("tx_id", form.tx_id.trim());
    if (file) fd.append("screenshot", file);
    setBusy(true);
    try {
      await api.post("/admin/crypto/purchase-request", fd);
      toast.success("Purchase request submitted", { description: "Super Admin will verify and credit your coins." });
      setForm({ usdt_amount: "", inr_equivalent: "", sender_wallet: "", tx_id: "" }); setFile(null);
      await load();
    } catch (e) {
      toast.error("Couldn't submit request", { description: e.response?.data?.detail || "" });
    } finally { setBusy(false); }
  };

  if (loading) return <Spinner label="Loading USDT purchase…" />;
  const noAddress = !cfg.usdt_address;

  return (
    <div data-testid="crypto-buy-panel">
      <PanelHeader title="Buy Coins via USDT" subtitle="Send USDT (TRC-20) to the Super Admin's receiving wallet, then submit proof. Coins are credited after verification." />

      {noAddress && (
        <div className="mb-5 flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700" data-testid="crypto-no-address">
          <Info className="h-4 w-4" /> The Super Admin hasn&apos;t published a receiving wallet yet. Please check back shortly.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Receiving wallet */}
        <div className={`${CARD} p-5`} data-testid="crypto-receiving-card">
          <p className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900"><Bitcoin className="h-4 w-4 text-amber-500" /> Super Admin receiving wallet</p>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div className="grid h-40 w-40 shrink-0 place-items-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
              {cfg.has_qr
                ? <AuthImage path="/admin/crypto/qr" alt="USDT QR" className="h-40 w-40 object-contain" testid="crypto-qr-img" />
                : <div className="flex flex-col items-center gap-1 text-slate-300"><QrCode className="h-10 w-10" /><span className="text-xs">No QR</span></div>}
            </div>
            <div className="w-full">
              <p className="text-xs font-semibold text-slate-500">Network</p>
              <span className="mb-2 inline-block rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700" data-testid="crypto-network">{cfg.network}</span>
              <p className="text-xs font-semibold text-slate-500">Wallet address</p>
              <div className="mt-1 flex items-center gap-2">
                <code data-testid="crypto-address" className="flex-1 break-all rounded-lg bg-slate-100 px-2.5 py-2 text-[11px] text-slate-800">{cfg.usdt_address || "—"}</code>
                <button data-testid="crypto-copy-address" onClick={copyAddr} disabled={noAddress} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40">
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <p className="mt-3 text-[11px] text-slate-500">Rate: <b className="text-slate-800">1 INR-equiv → {cfg.coin_rate} coins</b> · Min: <b className="text-slate-800">₹{fmtCoins(cfg.min_inr)}</b> per request</p>
            </div>
          </div>
        </div>

        {/* Submit proof */}
        <div className={`${CARD} p-5`} data-testid="crypto-submit-card">
          <p className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900"><Upload className="h-4 w-4 text-sky-600" /> Submit your transfer</p>
          <div className="grid gap-3">
            <Field label="USDT amount sent" type="number" data-testid="crypto-usdt-amount" value={form.usdt_amount} onChange={(e) => setForm((f) => ({ ...f, usdt_amount: e.target.value }))} placeholder="e.g. 1200" />
            <Field label="INR-equivalent value (₹)" hint="Based on your exchange rate at time of transfer" type="number" data-testid="crypto-inr-amount" value={form.inr_equivalent} onChange={(e) => setForm((f) => ({ ...f, inr_equivalent: e.target.value }))} placeholder={`min ${cfg.min_inr}`} />
            <div className="flex items-center gap-2 rounded-xl bg-sky-50 px-3 py-2 text-sm font-bold text-sky-700" data-testid="crypto-coin-preview">
              <Coins className="h-4 w-4" /> You&apos;ll receive ≈ {fmtCoins(coinPreview)} coins
            </div>
            <Field label="Your sending wallet address (USDT / TRC-20)" data-testid="crypto-sender-wallet" value={form.sender_wallet} onChange={(e) => setForm((f) => ({ ...f, sender_wallet: e.target.value }))} placeholder="The address you sent FROM" />
            <Field label="Transaction ID / hash (optional if screenshot attached)" data-testid="crypto-txid" value={form.tx_id} onChange={(e) => setForm((f) => ({ ...f, tx_id: e.target.value }))} placeholder="Exchange transaction reference" />
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-500">Proof screenshot (optional)</span>
              <input data-testid="crypto-screenshot" type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-xs file:font-semibold" />
              {file && <span className="mt-1 block text-[11px] text-emerald-600">{file.name}</span>}
            </label>
            <PrimaryButton data-testid="crypto-submit" onClick={submit} disabled={busy || noAddress}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bitcoin className="h-4 w-4" />} Submit purchase request
            </PrimaryButton>
          </div>
        </div>
      </div>

      {/* My purchases */}
      <div className={`${CARD} mt-6 overflow-hidden`} data-testid="crypto-my-purchases">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">My USDT purchases</div>
        {purchases.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">No purchases yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-100 bg-slate-50/60">
              <th className={thCls}>Date</th><th className={thCls}>USDT</th><th className={thCls}>INR-equiv</th><th className={thCls}>Coins</th><th className={thCls}>Status</th>
            </tr></thead>
            <tbody>
              {purchases.map((p) => (
                <tr key={p.id} className="border-b border-slate-50" data-testid={`crypto-purchase-${p.id}`}>
                  <td className={tdCls}>{fmtDate(p.created_at)}</td>
                  <td className={tdCls}>{p.usdt_amount}</td>
                  <td className={tdCls}>₹{fmtCoins(p.inr_equivalent)}</td>
                  <td className={`${tdCls} font-bold text-sky-600`}>{p.coins_credited != null ? fmtCoins(p.coins_credited) : `≈${fmtCoins(p.coins_preview)}`}</td>
                  <td className={tdCls}><StatusBadge status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
