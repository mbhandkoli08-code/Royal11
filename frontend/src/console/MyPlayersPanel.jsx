import { useCallback, useEffect, useMemo, useState } from "react";
import { Gift, Loader2, Wallet2, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { useConsoleApi, fmtCoins, fmtDate, shortId } from "./api";
import {
  CARD, thCls, tdCls, PanelHeader, StatCard, GhostButton, PrimaryButton,
  Modal, Field, Spinner, EmptyState,
} from "./primitives";

// Admin console: my players + grant coins to them.
export const MyPlayersPanel = ({ query = "" }) => {
  const api = useConsoleApi();
  const [rows, setRows] = useState([]);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [grantTarget, setGrantTarget] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, w] = await Promise.all([api.get("/admin/my-players"), api.get("/wallet/me")]);
      setRows(p.data);
      setBalance(w.data.wallet.balance);
    } catch {
      toast.error("Couldn't load your players");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.player.display_name.toLowerCase().includes(q) || r.player.email.toLowerCase().includes(q) || r.player.id.includes(q));
  }, [rows, query]);

  const openGrant = (row) => { setForm({ amount: "", reason: "" }); setGrantTarget(row); };

  const submitGrant = async () => {
    if (busy) return;
    const amount = Number(form.amount);
    if (!amount || amount <= 0) return toast.error("Enter a positive amount");
    setBusy(true);
    try {
      await api.post("/admin/grant", {
        player_id: grantTarget.player.id, amount,
        reason: form.reason || undefined, request_id: crypto.randomUUID(),
      });
      toast.success(`Granted ${fmtCoins(amount)} coins`);
      setGrantTarget(null);
      await load();
    } catch (e) {
      toast.error("Couldn't grant", { description: e.response?.data?.detail || "" });
    } finally { setBusy(false); }
  };

  if (loading) return <Spinner label="Loading your players…" />;

  return (
    <div data-testid="my-players-panel">
      <PanelHeader title="My Players" subtitle="Grant coins from your wallet into a player’s balance." />

      <div className="mb-8 grid grid-cols-2 gap-4 sm:max-w-md">
        <StatCard testid="admin-wallet" icon={Wallet2} label="Wallet Balance" value={fmtCoins(balance)} />
        <StatCard testid="admin-player-count" icon={UsersRound} label="My Players" value={fmtCoins(rows.length)} accent="cherry" />
      </div>

      {filtered.length === 0 ? (
        <EmptyState testid="my-players-empty" title="No players assigned" subtitle="Players assigned to you will appear here." />
      ) : (
        <div className={`${CARD} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm" data-testid="my-players-table">
              <thead>
                <tr className="border-b border-white/5">
                  <th className={thCls}>Player</th>
                  <th className={thCls}>Balance</th>
                  <th className={thCls}>Assigned</th>
                  <th className={`${thCls} text-right`}>Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filtered.map((r) => (
                  <tr key={r.player.id} data-testid={`my-player-row-${r.player.id}`} className="transition-colors hover:bg-white/[0.02]">
                    <td className={tdCls}>
                      <p className="font-bold text-white">{r.player.display_name}</p>
                      <p className="text-[11px] text-[#8c8385]">{r.player.email}</p>
                      <p className="font-mono text-[11px] text-[#8c8385]">{shortId(r.player.id)}</p>
                    </td>
                    <td className={`${tdCls} text-[#d4af37]`}>{fmtCoins(r.balance)}</td>
                    <td className={`${tdCls} text-xs text-[#8c8385]`}>{fmtDate(r.assigned_at)}</td>
                    <td className={tdCls}>
                      <div className="flex justify-end">
                        <GhostButton data-testid={`grant-${r.player.id}`} onClick={() => openGrant(r)} className="!px-3 !py-2 text-xs"><Gift className="h-3.5 w-3.5" /> Grant</GhostButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={!!grantTarget} onClose={() => setGrantTarget(null)} title={`Grant to ${grantTarget?.player.display_name || ""}`} testid="grant-modal">
        <div className="space-y-4">
          <p className="text-xs text-[#8c8385]">Moves coins from your wallet ({fmtCoins(balance)} available) into this player’s balance.</p>
          <Field label="Amount" type="number" data-testid="grant-amount" value={form.amount || ""} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="e.g. 500" />
          <Field label="Reason (optional)" data-testid="grant-reason" value={form.reason || ""} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
          <PrimaryButton data-testid="grant-submit" onClick={submitGrant} disabled={busy} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />} Grant Coins
          </PrimaryButton>
        </div>
      </Modal>
    </div>
  );
};
