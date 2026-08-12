import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Users, UserCheck, UsersRound, Database, ArrowUpRight, ArrowDownLeft, Download,
  Eye, EyeOff, Banknote, Scale, Receipt, ChevronDown, KeyRound, ShieldAlert,
  Landmark, Trophy, Globe2, ClipboardList,
} from "lucide-react";
import { toast } from "sonner";
import { useConsoleApi, fmtCoins, shortId } from "./api";
import {
  CARD, thCls, tdCls, PanelHeader, StatCard, UsageBar, GhostButton, Spinner, EmptyState, AnimatedNumber,
} from "./primitives";

// Quick-action tile (icon-in-circle + label).
const QuickTile = ({ icon: Icon, label, onClick, testid }) => (
  <button data-testid={testid} onClick={onClick}
    className="flex flex-col items-center gap-2 rounded-2xl border border-slate-200/60 bg-white p-4 text-center shadow-[0_2px_10px_-3px_rgba(6,81,237,0.08)] transition-transform hover:-translate-y-[2px]">
    <span className="grid h-11 w-11 place-items-center rounded-full bg-sky-500 text-white"><Icon className="h-5 w-5" /></span>
    <span className="text-xs font-semibold text-slate-700">{label}</span>
  </button>
);

const QuickLink = ({ icon: Icon, label, onClick, testid }) => (
  <button data-testid={testid} onClick={onClick}
    className="flex items-center gap-3 rounded-xl border border-slate-200/60 bg-white px-3 py-3 text-left transition-colors hover:bg-slate-50">
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sky-50 text-sky-600"><Icon className="h-[18px] w-[18px]" /></span>
    <span className="text-sm font-semibold text-slate-700">{label}</span>
  </button>
);

// Super Admin landing dashboard. Every stat is computed server-side from real
// DB state via GET /api/admin/overview — no fabricated charts/metrics.
export const OverviewPanel = ({ onNavigate }) => {
  const api = useConsoleApi();
  const [data, setData] = useState(null);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [range, setRange] = useState("all"); // "all" | "week"
  const [revealed, setRevealed] = useState(false);
  const [showActivity, setShowActivity] = useState(true);

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
    } catch { toast.error("Export failed"); } finally { setExporting(false); }
  };

  if (loading) return <Spinner label="Loading dashboard…" />;
  if (!data) return <EmptyState title="No data yet" subtitle="The dashboard will populate as the platform is used." />;

  const t = data.totals;
  const weekDeposits = summary.reduce((a, s) => a + (s.total_deposits_inr || 0), 0);
  const heroValue = range === "all" ? t.coins_in_circulation : weekDeposits;
  const heroLabel = range === "all" ? "Coins in Circulation (all wallets)" : "Deposits collected this week (₹)";

  return (
    <div data-testid="overview-panel">
      <PanelHeader title="Overview" subtitle="Live snapshot of the coin economy — all figures are real." />

      {/* Segmented range toggle */}
      <div className="mb-6 inline-flex rounded-full bg-slate-100 p-1" data-testid="overview-range-toggle">
        {[{ id: "week", label: "This Week" }, { id: "all", label: "All Time" }].map((v) => (
          <button key={v.id} data-testid={`overview-range-${v.id}`} onClick={() => { setRange(v.id); setRevealed(false); }}
            className={`relative rounded-full px-5 py-2 text-sm font-semibold transition-colors ${range === v.id ? "text-sky-700" : "text-slate-500 hover:text-slate-800"}`}>
            {range === v.id && <motion.span layoutId="overview-range" className="absolute inset-0 rounded-full bg-white shadow-sm" transition={{ type: "spring", stiffness: 380, damping: 32 }} />}
            <span className="relative">{v.label}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* LEFT column */}
        <div className="space-y-6 lg:col-span-2">
          {/* Masked balance hero */}
          <div className={`${CARD} p-6`} data-testid="overview-hero">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{heroLabel}</span>
              <button data-testid="balance-reveal-toggle" onClick={() => setRevealed((r) => !r)}
                className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700">
                {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-3 font-display text-4xl font-bold tracking-tight text-slate-900 tabular-nums" data-testid="overview-hero-value">
              {revealed
                ? <>{range === "week" ? "₹" : ""}<AnimatedNumber value={heroValue} format={fmtCoins} testid="hero-num" /></>
                : <span className="tracking-[0.15em] text-slate-400">••••••••</span>}
            </p>
            <p className="mt-1 text-xs text-slate-400">{revealed ? "Tap the eye to hide" : "Hidden for privacy — tap the eye to reveal"}</p>
          </div>

          {/* Economy stat cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <StatCard testid="stat-managers" icon={UserCheck} label="Total Managers" value={<AnimatedNumber value={t.managers} format={fmtCoins} testid="stat-managers-num" />} />
            <StatCard testid="stat-admins" icon={Users} label="Total Admins" value={<AnimatedNumber value={t.admins} format={fmtCoins} testid="stat-admins-num" />} />
            <StatCard testid="stat-players" icon={UsersRound} label="Total Players" value={<AnimatedNumber value={t.players} format={fmtCoins} testid="stat-players-num" />} />
            <StatCard testid="stat-coins-allocated" icon={ArrowUpRight} label="Coins Allocated" value={<AnimatedNumber value={t.coins_allocated} format={fmtCoins} testid="stat-allocated-num" />} accent="cherry" sub="Pushed down to Admins" />
            <StatCard testid="stat-coins-remaining" icon={ArrowDownLeft} label="Coins Remaining" value={<AnimatedNumber value={t.coins_remaining} format={fmtCoins} testid="stat-remaining-num" />} sub="Unused quota" />
            <StatCard testid="stat-coins-in-circulation" icon={Database} label="In Circulation" value={<AnimatedNumber value={t.coins_in_circulation} format={fmtCoins} testid="stat-circulation-num" />} sub="All wallet balances" />
          </div>

          {/* Quick actions */}
          <div>
            <h2 className="mb-3 font-display text-sm font-bold uppercase tracking-wider text-slate-500">Quick Actions</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <QuickTile testid="qa-deposits" icon={Banknote} label="Deposits" onClick={() => onNavigate?.("deposits")} />
              <QuickTile testid="qa-settlements" icon={Scale} label="Settle Payouts" onClick={() => onNavigate?.("settlements")} />
              <QuickTile testid="qa-report" icon={Download} label={exporting ? "Exporting…" : "View Report"} onClick={exportCsv} />
              <QuickTile testid="qa-transactions" icon={Receipt} label="Transactions" onClick={() => onNavigate?.("transactions")} />
            </div>
          </div>

          {/* Collapsible recent activity */}
          <div className={`${CARD} overflow-hidden`}>
            <button data-testid="activity-toggle" onClick={() => setShowActivity((s) => !s)}
              className="flex w-full items-center justify-between px-5 py-4 text-left">
              <span className="font-display text-base font-bold text-slate-900">Recent Activity</span>
              <ChevronDown className={`h-5 w-5 text-slate-400 transition-transform ${showActivity ? "rotate-180" : ""}`} />
            </button>
            {showActivity && (
              <div className="border-t border-slate-100" data-testid="activity-body">
                {summary.length === 0 ? (
                  <div className="px-5 py-6 text-sm text-slate-400">No activity yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-left text-sm" data-testid="daily-summary-table">
                      <thead><tr className="border-b border-slate-100">
                        <th className={thCls}>Date</th><th className={thCls}>Deposits (₹)</th>
                        <th className={thCls}>Allocations</th><th className={thCls}>Txns</th>
                      </tr></thead>
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
                )}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT column — Quick Links */}
        <div className="space-y-6">
          <div className={`${CARD} p-5`} data-testid="quick-links">
            <h2 className="mb-3 font-display text-base font-bold text-slate-900">Manage</h2>
            <div className="grid grid-cols-1 gap-2.5">
              <QuickLink testid="ql-zonal" icon={Globe2} label="Zonal Managers" onClick={() => onNavigate?.("zonal-managers")} />
              <QuickLink testid="ql-managers" icon={UserCheck} label="Managers" onClick={() => onNavigate?.("managers")} />
              <QuickLink testid="ql-admins" icon={Users} label="Admins & Branding" onClick={() => onNavigate?.("admins")} />
              <QuickLink testid="ql-requests" icon={ClipboardList} label="Admin Requests" onClick={() => onNavigate?.("admin-requests")} />
              <QuickLink testid="ql-fantasy" icon={Trophy} label="Fantasy Contests" onClick={() => onNavigate?.("fantasy")} />
              <QuickLink testid="ql-apikeys" icon={KeyRound} label="API Keys" onClick={() => onNavigate?.("apikeys")} />
              <QuickLink testid="ql-security" icon={ShieldAlert} label="Login Security" onClick={() => onNavigate?.("security")} />
            </div>
          </div>
        </div>
      </div>

      {/* Manager Allocation & Performance */}
      <div className="mt-8">
        <h2 className="mb-4 font-display text-lg font-extrabold tracking-tight text-slate-900">Manager Allocation &amp; Performance</h2>
        {data.managers.length === 0 ? (
          <EmptyState testid="overview-managers-empty" title="No managers yet" subtitle="Create a Manager from the Managers tab to get started." />
        ) : (
          <div className={`${CARD} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm" data-testid="overview-managers-table">
                <thead><tr className="border-b border-slate-100">
                  <th className={thCls}>Manager</th><th className={thCls}>Quota</th><th className={thCls}>Allocated</th>
                  <th className={thCls}>Usage</th><th className={thCls}>Admins</th><th className={thCls}>Players</th>
                </tr></thead>
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
    </div>
  );
};
