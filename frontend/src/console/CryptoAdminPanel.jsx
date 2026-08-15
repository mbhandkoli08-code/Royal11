import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Bitcoin, Loader2, Save, Upload, Check, X, Eye, Settings2, QrCode, Download, Link2, ShieldCheck } from "lucide-react";
import { useConsoleApi, fmtCoins, fmtDate } from "@/console/api";
import { PanelHeader, Field, PrimaryButton, GhostButton, Spinner, Modal, CARD, thCls, tdCls, StatusBadge, EmptyState } from "@/console/primitives";
import { AuthImage } from "@/console/AuthImage";

// SUPER ADMIN: configure the ONE receiving wallet (address + QR + rate + min)
// and review/confirm/reject Admin USDT purchase requests.
export const CryptoAdminPanel = () => {
  const api = useConsoleApi();
  const [cfg, setCfg] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingCfg, setSavingCfg] = useState(false);
  const [uploadingQr, setUploadingQr] = useState(false);
  const [filter, setFilter] = useState("PENDING");
  const [adminFilter, setAdminFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [adminOptions, setAdminOptions] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [detail, setDetail] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [acting, setActing] = useState(false);
  const [qrKey, setQrKey] = useState(0);

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams();
    // "AUTO" isn't a DB status — it's CONFIRMED rows flagged auto_approved.
    const statusForApi = filter === "AUTO" ? "CONFIRMED" : filter;
    if (statusForApi !== "ALL") p.append("status", statusForApi);
    if (adminFilter) p.append("admin_id", adminFilter);
    if (dateFrom) p.append("date_from", dateFrom);
    if (dateTo) p.append("date_to", dateTo);
    const s = p.toString();
    return s ? `?${s}` : "";
  }, [filter, adminFilter, dateFrom, dateTo]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, r, a] = await Promise.all([
        api.get("/superadmin/crypto/config"),
        api.get(`/superadmin/crypto/requests${buildQuery()}`),
        api.get("/superadmin/crypto/admins"),
      ]);
      setCfg(c.data); setRequests(r.data); setAdminOptions(a.data);
    } catch { toast.error("Couldn't load USDT purchases"); } finally { setLoading(false); }
  }, [api, buildQuery]);

  useEffect(() => { load(); }, [load]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const { data } = await api.get(`/superadmin/crypto/requests.csv${buildQuery()}`, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url; a.download = "usdt_purchases.csv"; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error("Couldn't export CSV"); } finally { setExporting(false); }
  };

  const saveCfg = async () => {
    setSavingCfg(true);
    try {
      const { data } = await api.put("/superadmin/crypto/config", {
        usdt_address: cfg.usdt_address, network: cfg.network,
        coin_rate: Number(cfg.coin_rate), min_inr: Math.round(Number(cfg.min_inr)),
        auto_approve_max_usdt: cfg.auto_approve_max_usdt === "" || cfg.auto_approve_max_usdt == null
          ? 0 : Number(cfg.auto_approve_max_usdt),
      });
      setCfg(data);
      toast.success("Settings saved");
    } catch (e) { toast.error("Couldn't save", { description: e.response?.data?.detail || "" }); }
    finally { setSavingCfg(false); }
  };

  const uploadQr = async (file) => {
    if (!file) return;
    const fd = new FormData(); fd.append("qr", file);
    setUploadingQr(true);
    try {
      const { data } = await api.post("/superadmin/crypto/config/qr", fd);
      setCfg(data); setQrKey((k) => k + 1);
      toast.success("QR image updated");
    } catch { toast.error("Couldn't upload QR"); } finally { setUploadingQr(false); }
  };

  const confirmReq = async (id) => {
    setActing(true);
    try {
      await api.post(`/superadmin/crypto/requests/${id}/confirm`);
      toast.success("Confirmed — coins credited to the Admin");
      setDetail(null); await load();
    } catch (e) { toast.error("Couldn't confirm", { description: e.response?.data?.detail || "" }); }
    finally { setActing(false); }
  };

  const submitReject = async () => {
    setActing(true);
    try {
      await api.post(`/superadmin/crypto/requests/${rejecting.id}/reject`, { reason: rejectReason });
      toast.success("Request rejected");
      setRejecting(null); setRejectReason(""); setDetail(null); await load();
    } catch (e) { toast.error("Couldn't reject", { description: e.response?.data?.detail || "" }); }
    finally { setActing(false); }
  };

  if (loading || !cfg) return <Spinner label="Loading USDT purchases…" />;

  // "Auto-approved" tab = CONFIRMED rows flagged auto_approved (client-side slice).
  const shown = filter === "AUTO" ? requests.filter((r) => r.auto_approved) : requests;

  return (
    <div data-testid="crypto-admin-panel">
      <PanelHeader title="USDT Coin Purchases" subtitle="Configure your single receiving wallet and review Admin USDT top-up requests." />

      {/* Settings */}
      <div className={`${CARD} mb-6 p-5`} data-testid="crypto-settings-card">
        <p className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900"><Settings2 className="h-4 w-4 text-sky-600" /> Receiving wallet settings</p>
        <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-500">QR image</p>
            <div className="grid h-44 w-44 place-items-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
              {cfg.has_qr
                ? <AuthImage key={qrKey} path="/admin/crypto/qr" alt="QR" className="h-44 w-44 object-contain" testid="crypto-admin-qr" />
                : <div className="flex flex-col items-center gap-1 text-slate-300"><QrCode className="h-10 w-10" /><span className="text-xs">No QR yet</span></div>}
            </div>
            <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
              {uploadingQr ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {cfg.has_qr ? "Replace QR" : "Upload QR"}
              <input data-testid="crypto-qr-upload" type="file" accept="image/*" className="hidden" onChange={(e) => uploadQr(e.target.files?.[0])} />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold text-slate-500">USDT receiving address (typed)</span>
              <input data-testid="crypto-cfg-address" value={cfg.usdt_address || ""} onChange={(e) => setCfg((c) => ({ ...c, usdt_address: e.target.value }))}
                placeholder="e.g. TXYZ...static receiving address" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-sky-400" />
            </label>
            <Field label="Network" data-testid="crypto-cfg-network" value={cfg.network || ""} onChange={(e) => setCfg((c) => ({ ...c, network: e.target.value }))} placeholder="TRC-20" />
            <Field label="Coin rate (coins per ₹1 INR-equiv)" type="number" step="0.01" data-testid="crypto-cfg-rate" value={cfg.coin_rate} onChange={(e) => setCfg((c) => ({ ...c, coin_rate: e.target.value }))} />
            <Field label="Minimum INR-equivalent per request" type="number" data-testid="crypto-cfg-min" value={cfg.min_inr} onChange={(e) => setCfg((c) => ({ ...c, min_inr: e.target.value }))} />
            <Field label="Auto-approve cap (USDT · 0 = unlimited)" type="number" step="0.01" data-testid="crypto-cfg-autocap"
              value={cfg.auto_approve_max_usdt ?? ""} onChange={(e) => setCfg((c) => ({ ...c, auto_approve_max_usdt: e.target.value }))}
              hint="On-chain-verified purchases auto-credit instantly. Set a USDT ceiling to force manual review above it; 0 = no cap." />
            <div className="flex items-end sm:col-span-2">
              <PrimaryButton data-testid="crypto-cfg-save" onClick={saveCfg} disabled={savingCfg}>
                {savingCfg ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save settings
              </PrimaryButton>
            </div>
          </div>
        </div>
      </div>

      {/* Queue / history report */}
      <PanelHeader title="Purchase history & report" subtitle="Every USDT purchase — who paid, from which wallet, how much, when and how many coins were credited." />
      <div className="mb-3 flex flex-wrap items-end gap-3" data-testid="crypto-report-filters">
        <div className="inline-flex rounded-full bg-slate-100 p-1" data-testid="crypto-filter">
          {["PENDING", "CONFIRMED", "AUTO", "REJECTED", "ALL"].map((f) => (
            <button key={f} data-testid={`crypto-filter-${f.toLowerCase()}`} onClick={() => setFilter(f)}
              className={`rounded-full px-4 py-1.5 text-xs font-bold transition-colors ${filter === f ? "bg-white text-sky-700 shadow-sm" : "text-slate-500"}`}>{f === "AUTO" ? "Auto-approved" : f}</button>
          ))}
        </div>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-slate-500">Admin</span>
          <select data-testid="crypto-filter-admin" value={adminFilter} onChange={(e) => setAdminFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-400">
            <option value="">All admins</option>
            {adminOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-slate-500">From</span>
          <input data-testid="crypto-filter-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-400" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-slate-500">To</span>
          <input data-testid="crypto-filter-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-400" />
        </label>
        <GhostButton data-testid="crypto-export-csv" onClick={exportCsv} disabled={exporting} className="ml-auto">
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export CSV
        </GhostButton>
      </div>

      <div className={`${CARD} overflow-hidden`}>
        {shown.length === 0 ? (
          <EmptyState title="No requests" subtitle={filter === "AUTO" ? "No blockchain auto-approved purchases yet." : `No ${filter.toLowerCase()} USDT purchase requests.`} testid="crypto-empty" />
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-100 bg-slate-50/60">
              <th className={thCls}>Date</th><th className={thCls}>Admin</th><th className={thCls}>USDT</th><th className={thCls}>INR-equiv</th><th className={thCls}>Coins</th><th className={thCls}>Status</th><th className={thCls}></th>
            </tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-b border-slate-50" data-testid={`crypto-req-${r.id}`}>
                  <td className={tdCls}>{fmtDate(r.created_at)}</td>
                  <td className={`${tdCls} font-semibold text-slate-900`}>{r.admin_name || "—"}</td>
                  <td className={tdCls}>{r.usdt_amount}</td>
                  <td className={tdCls}>₹{fmtCoins(r.inr_equivalent)}</td>
                  <td className={`${tdCls} font-bold text-sky-600`}>{r.coins_credited != null ? fmtCoins(r.coins_credited) : `≈${fmtCoins(r.coins_preview)}`}</td>
                  <td className={tdCls}>
                    <div className="flex items-center gap-1.5">
                      <StatusBadge status={r.status} />
                      {r.auto_approved && (
                        <span data-testid={`crypto-auto-badge-${r.id}`} className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700"><Link2 className="h-3 w-3" /> Chain-verified</span>
                      )}
                    </div>
                  </td>
                  <td className={tdCls}>
                    <button data-testid={`crypto-view-${r.id}`} onClick={() => setDetail(r)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"><Eye className="h-3.5 w-3.5" /> Review</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail / review modal */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title="USDT purchase request" testid="crypto-detail-modal">
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs text-slate-500">Admin</p><p className="font-semibold text-slate-900">{detail.admin_name}</p></div>
              <div><p className="text-xs text-slate-500">Status</p><StatusBadge status={detail.status} /></div>
              <div><p className="text-xs text-slate-500">USDT sent</p><p className="font-semibold text-slate-900">{detail.usdt_amount} <span className="text-xs text-slate-400">{detail.network}</span></p></div>
              <div><p className="text-xs text-slate-500">INR-equivalent</p><p className="font-semibold text-slate-900">₹{fmtCoins(detail.inr_equivalent)}</p></div>
              <div><p className="text-xs text-slate-500">Coins ({detail.coin_rate_at_submit}×)</p><p className="font-bold text-sky-600">{detail.coins_credited != null ? fmtCoins(detail.coins_credited) : `≈${fmtCoins(detail.coins_preview)}`}</p></div>
              <div><p className="text-xs text-slate-500">Tx ID</p><p className="break-all font-mono text-xs text-slate-700">{detail.tx_id || "—"}</p></div>
              <div className="col-span-2"><p className="text-xs text-slate-500">Admin sending wallet</p><p className="break-all font-mono text-xs text-slate-700" data-testid="crypto-detail-sender">{detail.sender_wallet || "—"}</p></div>
              <div className="col-span-2"><p className="text-xs text-slate-500">Receiving wallet (at time of request)</p><p className="break-all font-mono text-xs text-slate-700">{detail.usdt_address || "—"}</p></div>
              <div><p className="text-xs text-slate-500">Submitted</p><p className="text-xs text-slate-700">{fmtDate(detail.created_at)}</p></div>
              <div><p className="text-xs text-slate-500">{detail.status === "PENDING" ? "Decision" : "Decided"}</p><p className="text-xs text-slate-700">{detail.decided_at ? `${fmtDate(detail.decided_at)}${detail.decided_by_name ? ` · ${detail.decided_by_name}` : ""}` : "Awaiting decision"}</p></div>
            </div>
            {detail.chain_verification && (
              <div data-testid="crypto-chain-panel" className={`rounded-xl border p-3 ${detail.chain_verification.verified ? "border-violet-200 bg-violet-50" : "border-amber-200 bg-amber-50"}`}>
                <div className={`flex items-center gap-1.5 text-xs font-bold ${detail.chain_verification.verified ? "text-violet-700" : "text-amber-700"}`}>
                  {detail.chain_verification.verified ? <ShieldCheck className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                  {detail.chain_verification.verified ? "Blockchain-verified — auto-approved (no human review)" : "On-chain check did not auto-approve"}
                </div>
                <p className="mt-1 text-xs text-slate-600">{detail.chain_verification.reason}</p>
                {detail.chain_verification.extracted?.amount_usdt != null && (
                  <p className="mt-1 text-[11px] text-slate-500">On-chain: {detail.chain_verification.extracted.amount_usdt} USDT → {detail.chain_verification.extracted.to_address}</p>
                )}
              </div>
            )}
            {detail.has_proof && (
              <div>
                <p className="mb-1 text-xs text-slate-500">Proof screenshot</p>
                <AuthImage path={`/superadmin/crypto/requests/${detail.id}/screenshot`} alt="Proof" className="max-h-72 w-full rounded-xl object-contain bg-slate-50" testid="crypto-proof-img" />
              </div>
            )}
            {detail.reason && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">Reason: {detail.reason}</p>}
            {detail.status === "PENDING" && (
              <div className="flex gap-2 pt-2">
                <PrimaryButton data-testid="crypto-confirm-btn" onClick={() => confirmReq(detail.id)} disabled={acting} className="flex-1">
                  {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Confirm & credit
                </PrimaryButton>
                <GhostButton data-testid="crypto-reject-btn" onClick={() => { setRejecting(detail); }} className="flex-1"><X className="h-4 w-4" /> Reject</GhostButton>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Reject reason modal */}
      <Modal open={!!rejecting} onClose={() => { setRejecting(null); setRejectReason(""); }} title="Reject purchase request" testid="crypto-reject-modal">
        <div className="space-y-3">
          <Field label="Reason (optional)" data-testid="crypto-reject-reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="e.g. Proof unclear / amount mismatch" />
          <div className="flex gap-2">
            <GhostButton onClick={() => { setRejecting(null); setRejectReason(""); }} className="flex-1">Cancel</GhostButton>
            <PrimaryButton data-testid="crypto-reject-submit" onClick={submitReject} disabled={acting} className="flex-1">{acting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reject"}</PrimaryButton>
          </div>
        </div>
      </Modal>
    </div>
  );
};
