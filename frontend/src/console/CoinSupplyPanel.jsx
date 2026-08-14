import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Coins, Sparkles, Wallet2, Loader2, Globe2, UserCheck, TrendingUp } from "lucide-react";
import { useConsoleApi, fmtCoins } from "@/console/api";
import { PanelHeader, StatCard, Field, PrimaryButton, Spinner, CARD, thCls, tdCls, StatusBadge } from "@/console/primitives";

// Super Admin: the ROOT coin supply. Minting = crediting new spendable coins
// into a Zonal Manager / Manager wallet (no source wallet — this is where all
// platform coins originate). Clearly labeled "Generate Coins" for discoverability.
export const CoinSupplyPanel = () => {
  const api = useConsoleApi();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/coin-supply");
      setData(data);
      if (!recipient && data.recipients?.length) setRecipient(data.recipients[0].id);
    } catch { toast.error("Couldn't load coin supply"); } finally { setLoading(false); }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    const amt = Math.round(Number(amount));
    if (!amt || amt <= 0) return toast.error("Enter an amount to generate");
    const rec = data.recipients.find((r) => r.id === recipient);
    if (!rec) return toast.error("Choose a recipient");
    setBusy(true);
    try {
      const path = rec.role === "ZONAL_MANAGER"
        ? `/admin/zonal-managers/${rec.id}/fund`
        : `/admin/managers/${rec.id}/fund`;
      await api.post(path, { amount: amt, reason: reason || "Coin generation (mint)", request_id: crypto.randomUUID() });
      toast.success(`Generated ${fmtCoins(amt)} coins`, { description: `Minted into ${rec.name}'s wallet.` });
      setAmount(""); setReason("");
      await load();
    } catch (e) {
      toast.error("Couldn't generate coins", { description: e.response?.data?.detail || "" });
    } finally { setBusy(false); }
  };

  if (loading) return <Spinner label="Loading coin supply…" />;

  return (
    <div data-testid="coin-supply-panel">
      <PanelHeader title="Generate Coins" subtitle="The root coin supply — new coins enter the platform here, then flow down to Zonal Managers, Managers, Admins and Players." />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatCard icon={Sparkles} label="Total coins generated" value={fmtCoins(data.total_minted)} sub="All-time minted supply" accent="sky" testid="supply-total-minted" />
        <StatCard icon={TrendingUp} label="Coins in circulation" value={fmtCoins(data.coins_in_circulation)} sub="Across every wallet" accent="green" testid="supply-circulation" />
        <StatCard icon={Wallet2} label="Minted to Zonal / Managers" value={`${fmtCoins(data.minted_to_zonal)} / ${fmtCoins(data.minted_to_manager)}`} sub="By tier" accent="amber" testid="supply-by-tier" />
      </div>

      {/* Generate form */}
      <div className={`${CARD} mb-6 p-5`} data-testid="generate-coins-card">
        <p className="mb-1 flex items-center gap-2 text-sm font-bold text-slate-900"><Coins className="h-4 w-4 text-sky-600" /> Generate new coins</p>
        <p className="mb-4 text-xs text-slate-500">This mints brand-new spendable coins directly into the selected wallet (there is no source wallet — this is the origin of all platform coins). Use it to seed a Zonal Manager or Manager so they can allocate downstream.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-500">Recipient</span>
            <select data-testid="generate-recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-sky-400">
              {data.recipients.length === 0 && <option value="">No managers yet — create one first</option>}
              {data.recipients.map((r) => (
                <option key={r.id} value={r.id}>{r.role === "ZONAL_MANAGER" ? "🌐 " : "👤 "}{r.name} · {r.role === "ZONAL_MANAGER" ? "Zonal" : "Manager"} · bal {fmtCoins(r.wallet_balance)}</option>
              ))}
            </select>
          </label>
          <Field label="Amount to generate" type="number" data-testid="generate-amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 1000000" />
          <Field label="Reason (optional)" data-testid="generate-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Initial float" />
        </div>
        <PrimaryButton data-testid="generate-coins-submit" onClick={generate} disabled={busy || data.recipients.length === 0} className="mt-4">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Generate Coins
        </PrimaryButton>
      </div>

      {/* Recipient wallets */}
      <div className={`${CARD} overflow-hidden`}>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100 bg-slate-50/60">
            <th className={thCls}>Recipient</th><th className={thCls}>Tier</th><th className={thCls}>Status</th><th className={thCls}>Wallet balance</th>
          </tr></thead>
          <tbody>
            {data.recipients.map((r) => (
              <tr key={r.id} className="border-b border-slate-50" data-testid={`supply-row-${r.id}`}>
                <td className={`${tdCls} font-semibold text-slate-900`}>{r.name}</td>
                <td className={tdCls}>
                  <span className="inline-flex items-center gap-1 text-slate-600">
                    {r.role === "ZONAL_MANAGER" ? <Globe2 className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                    {r.role === "ZONAL_MANAGER" ? "Zonal Manager" : "Manager"}
                  </span>
                </td>
                <td className={tdCls}><StatusBadge status={r.status} /></td>
                <td className={`${tdCls} font-bold text-sky-600`}>{fmtCoins(r.wallet_balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
