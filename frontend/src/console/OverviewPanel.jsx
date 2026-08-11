import { useCallback, useEffect, useState } from "react";
import { Users, UserCheck, UsersRound, Database, ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { toast } from "sonner";
import { useConsoleApi, fmtCoins, shortId } from "./api";
import {
  CARD, thCls, tdCls, PanelHeader, StatCard, UsageBar, Spinner, EmptyState, ComingSoonCard,
} from "./primitives";

// Super Admin landing dashboard. Every stat is computed server-side from real
// DB state via GET /api/admin/overview — no fabricated charts/metrics.
export const OverviewPanel = () => {
  const api = useConsoleApi();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/overview");
      setData(data);
    } catch {
      toast.error("Couldn't load the dashboard");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Spinner label="Loading dashboard…" />;
  if (!data) return <EmptyState title="No data yet" subtitle="The dashboard will populate as the platform is used." />;

  const t = data.totals;

  return (
    <div data-testid="overview-panel">
      <PanelHeader title="Overview" subtitle="Live snapshot of the coin economy — all figures are real." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard testid="stat-managers" icon={UserCheck} label="Total Managers" value={fmtCoins(t.managers)} />
        <StatCard testid="stat-admins" icon={Users} label="Total Admins" value={fmtCoins(t.admins)} />
        <StatCard testid="stat-players" icon={UsersRound} label="Total Players" value={fmtCoins(t.players)} />
        <StatCard testid="stat-coins-in-circulation" icon={Database} label="Coins in Circulation" value={fmtCoins(t.coins_in_circulation)} sub="Sum of all wallet balances" />
        <StatCard testid="stat-coins-allocated" icon={ArrowUpRight} label="Coins Allocated" value={fmtCoins(t.coins_allocated)} accent="cherry" sub="Pushed down to Admins" />
        <StatCard testid="stat-coins-remaining" icon={ArrowDownLeft} label="Coins Remaining" value={fmtCoins(t.coins_remaining)} sub="Unused authorized quota" />
      </div>

      {/* Manager Allocation & Performance — buildable from real data */}
      <div className="mt-8">
        <h2 className="mb-4 font-display text-lg font-extrabold tracking-tight text-white">Manager Allocation &amp; Performance</h2>
        {data.managers.length === 0 ? (
          <EmptyState testid="overview-managers-empty" title="No managers yet" subtitle="Create a Manager from the Managers tab to get started." />
        ) : (
          <div className={`${CARD} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm" data-testid="overview-managers-table">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className={thCls}>Manager</th>
                    <th className={thCls}>Quota</th>
                    <th className={thCls}>Allocated</th>
                    <th className={thCls}>Usage</th>
                    <th className={thCls}>Admins</th>
                    <th className={thCls}>Players</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {data.managers.map((m) => (
                    <tr key={m.id} data-testid={`overview-manager-${m.id}`} className="transition-colors hover:bg-white/[0.02]">
                      <td className={tdCls}>
                        <p className="font-bold text-white">{m.name}</p>
                        <p className="font-mono text-[11px] text-[#8c8385]">{shortId(m.id)}</p>
                      </td>
                      <td className={`${tdCls} text-[#d4af37]`}>{fmtCoins(m.authorized_quota)}</td>
                      <td className={tdCls}>{fmtCoins(m.allocated_out)}</td>
                      <td className={tdCls}><UsageBar pct={m.usage_pct} /></td>
                      <td className={tdCls}>{m.admin_count}</td>
                      <td className={tdCls}>{m.player_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Honest placeholders for metrics we don't have real data sources for yet */}
      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        <ComingSoonCard testid="soon-usage" title="7-Day Coin Usage" note="Time-series analytics arrive once we track daily aggregates." />
        <ComingSoonCard testid="soon-dau" title="Daily Active Users" note="Session tracking isn't wired up yet." />
        <ComingSoonCard testid="soon-alerts" title="Critical System Alerts" note="No alerting pipeline connected yet." />
      </div>
    </div>
  );
};
