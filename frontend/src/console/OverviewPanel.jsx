import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Users, UserCheck, UsersRound, Database, ArrowUpRight, ArrowDownLeft, Download } from "lucide-react";
import { toast } from "sonner";
import { useConsoleApi, fmtCoins, shortId } from "./api";
import {
  CARD, thCls, tdCls, PanelHeader, StatCard, UsageBar, GhostButton, Spinner, EmptyState, ComingSoonCard, AnimatedNumber,
} from "./primitives";

// Super Admin landing dashboard. Every stat is computed server-side from real
// DB state via GET /api/admin/overview — no fabricated charts/metrics.
export const OverviewPanel = () => {
  const api = useConsoleApi();
  const [data, setData] = useState(null);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [view, setView] = useState("economy"); // "economy" | "activity"

  const load = useCallback(async () => {
    try {
      const [o, s] = await Promise.all([api.get("/admin/overview"), api.get("/admin/daily-summary?days=7")]);
      setData(o.data);
      setSummary(s.data);
    } catch {
      toast.error("Couldn't load the dashboard");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await api.get("/admin/daily-summary/export?days=30", { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url; a.download = "daily_summary.csv"; a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Export failed");
    } finally { setExporting(false); }
  };

  if (loading) return <Spinner label="Loading dashboard…" />;
  if (!data) return <EmptyState title="No data yet" subtitle="The dashboard will populate as the platform is used." />;

  const t = data.totals;

  return (
    <div data-testid="overview-panel">
      <PanelHeader title="Overview" subtitle="Live snapshot of the coin economy — all figures are real." />

      {/* Two-option view toggle */}
      <div className="mb-6 inline-flex rounded-full bg-slate-100 p-1" data-testid="overview-view-toggle">
        {[
          { id: "economy", label: "Coin Economy" },
          { id: "activity", label: "Daily Activity" },
        ].map((v) => (
          <button
            key={v.id}
            data-testid={`overview-toggle-${v.id}`}
            onClick={() => setView(v.id)}
            className={`relative rounded-full px-5 py-2 text-sm font-semibold transition-colors ${view === v.id ? "text-sky-700" : "text-slate-500 hover:text-slate-800"}`}
          >
            {view === v.id && <motion.span layoutId="overview-toggle" className="absolute inset-0 rounded-full bg-white shadow-sm" transition={{ type: "spring", stiffness: 380, damping: 32 }} />}
            <span className="relative">{v.label}</span>
          </button>
        ))}
      </div>

      {view === "economy" && (
      <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard testid="stat-managers" icon={UserCheck} label="Total Managers" value={<AnimatedNumber value={t.managers} format={fmtCoins} testid="stat-managers-num" />} />
        <StatCard testid="stat-admins" icon={Users} label="Total Admins" value={<AnimatedNumber value={t.admins} format={fmtCoins} testid="stat-admins-num" />} />
        <StatCard testid="stat-players" icon={UsersRound} label="Total Players" value={<AnimatedNumber value={t.players} format={fmtCoins} testid="stat-players-num" />} />
        <StatCard testid="stat-coins-in-circulation" icon={Database} label="Coins in Circulation" value={<AnimatedNumber value={t.coins_in_circulation} format={fmtCoins} testid="stat-circulation-num" />} sub="Sum of all wallet balances" />
        <StatCard testid="stat-coins-allocated" icon={ArrowUpRight} label="Coins Allocated" value={<AnimatedNumber value={t.coins_allocated} format={fmtCoins} testid="stat-allocated-num" />} accent="cherry" sub="Pushed down to Admins" />
        <StatCard testid="stat-coins-remaining" icon={ArrowDownLeft} label="Coins Remaining" value={<AnimatedNumber value={t.coins_remaining} format={fmtCoins} testid="stat-remaining-num" />} sub="Unused authorized quota" />
      </div>

      {/* Manager Allocation & Performance — buildable from real data */}
      <div className="mt-8">
        <h2 className="mb-4 font-display text-lg font-extrabold tracking-tight text-slate-900">Manager Allocation &amp; Performance</h2>
        {data.managers.length === 0 ? (
          <EmptyState testid="overview-managers-empty" title="No managers yet" subtitle="Create a Manager from the Managers tab to get started." />
        ) : (
          <div className={`${CARD} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm" data-testid="overview-managers-table">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className={thCls}>Manager</th>
                    <th className={thCls}>Quota</th>
                    <th className={thCls}>Allocated</th>
                    <th className={thCls}>Usage</th>
                    <th className={thCls}>Admins</th>
                    <th className={thCls}>Players</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.managers.map((m) => (
                    <tr key={m.id} data-testid={`overview-manager-${m.id}`} className="transition-colors hover:bg-slate-50">
                      <td className={tdCls}>
                        <p className="font-bold text-slate-900">{m.name}</p>
                        <p className="font-mono text-[11px] text-slate-400">{shortId(m.id)}</p>
                      </td>
                      <td className={`${tdCls} text-sky-600`}>{fmtCoins(m.authorized_quota)}</td>
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
      </>
      )}

      {view === "activity" && (
      <>
      {/* Daily transaction summary — real data, exportable */}
      <div className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-extrabold tracking-tight text-slate-900">Daily Transaction Summary</h2>
          <GhostButton data-testid="export-summary-btn" onClick={exportCsv} disabled={exporting} className="!px-3 !py-2 text-xs">
            <Download className="h-3.5 w-3.5" /> {exporting ? "Exporting…" : "Export CSV"}
          </GhostButton>
        </div>
        {summary.length === 0 ? (
          <EmptyState testid="summary-empty" title="No activity yet" subtitle="Daily figures appear as deposits and allocations flow." />
        ) : (
          <div className={`${CARD} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm" data-testid="daily-summary-table">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className={thCls}>Date</th>
                    <th className={thCls}>Deposits (₹)</th>
                    <th className={thCls}>Allocations (coins)</th>
                    <th className={thCls}>Transactions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.map((s) => (
                    <tr key={s.date} data-testid={`summary-row-${s.date}`} className="transition-colors hover:bg-slate-50">
                      <td className={tdCls}>{s.date}</td>
                      <td className={`${tdCls} text-sky-600`}>₹{fmtCoins(s.total_deposits_inr)}</td>
                      <td className={tdCls}>{fmtCoins(s.total_allocations_coins)}</td>
                      <td className={tdCls}>{s.total_transactions}</td>
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
      </>
      )}
    </div>
  );
};
