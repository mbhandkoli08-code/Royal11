import { useCallback, useEffect, useState, Fragment } from "react";
import { Coins, TrendingDown, Landmark, ChevronLeft, ChevronRight, Layers, Spade, HandCoins, FileText, FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useConsoleApi } from "./api";
import { CARD, thCls, tdCls, PanelHeader, StatCard, Spinner, EmptyState, GhostButton } from "./primitives";

const GAME_META = {
  rummy_points: { label: "Points Rummy", icon: Layers },
  high_card: { label: "High Card", icon: Spade },
  thane_matka: { label: "Thane Matka", icon: HandCoins },
};
const gameLabel = (gt) => GAME_META[gt]?.label || gt;
const fmt = (n) => (n || 0).toLocaleString("en-IN");
const SCOPE = {
  SUPER_ADMIN: "across the whole platform",
  ZONAL_MANAGER: "from your zone's admins & players",
  MANAGER: "from your admins & their players",
  ADMIN: "from your own players",
};

// Weekly House P&L trend — CSS bar chart (commission per Sun–Sat week).
const TrendChart = ({ points }) => {
  const max = Math.max(1, ...points.map((p) => p.commission));
  return (
    <div className={`${CARD} p-5`} data-testid="commission-trend">
      <p className="mb-4 text-sm font-bold text-slate-900">House P&amp;L trend — commission by week</p>
      <div className="flex h-40 items-end gap-2">
        {points.map((p) => (
          <div key={p.week_start} className="group flex flex-1 flex-col items-center justify-end" data-testid={`trend-bar-${p.week_start}`}>
            <span className="mb-1 text-[10px] font-bold text-slate-500 opacity-0 transition-opacity group-hover:opacity-100">{fmt(p.commission)}</span>
            <div className="w-full rounded-t-md bg-gradient-to-t from-sky-500 to-sky-400 transition-all"
              style={{ height: `${Math.max(4, (p.commission / max) * 100)}%` }} />
            <span className="mt-1.5 text-[9px] text-slate-400">{p.week_start.slice(5)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const CasinoCommissionPanel = () => {
  const api = useConsoleApi();
  const { user } = useAuth();
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [trend, setTrend] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rep, tr] = await Promise.all([
        api.get(`/casino/admin/commission-report?week_offset=${offset}`),
        api.get(`/casino/admin/commission-trend?weeks=8`),
      ]);
      setData(rep.data);
      setTrend(tr.data.points || []);
    } catch { toast.error("Couldn't load commission report"); }
    finally { setLoading(false); }
  }, [api, offset]);
  useEffect(() => { load(); }, [load]);

  const download = async (fmtType) => {
    setExporting(fmtType);
    try {
      const res = await api.get(`/casino/admin/commission-report.${fmtType}?week_offset=${offset}`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `royal11_commission_${data?.week_start || "week"}.${fmtType}`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      toast.success(`${fmtType.toUpperCase()} downloaded`);
    } catch { toast.error(`Couldn't export ${fmtType.toUpperCase()}`); }
    finally { setExporting(""); }
  };

  const t = data?.totals;
  return (
    <div data-testid="casino-commission-panel">
      <PanelHeader
        title="Casino Commission"
        subtitle={`Weekly house-commission rollup ${SCOPE[user?.role] || ""} — summed automatically from the per-round rake ledger. Sun–Sat weeks.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <GhostButton data-testid="commission-export-csv" onClick={() => download("csv")} disabled={!!exporting || loading} className="!px-3 !py-2 text-xs">
              {exporting === "csv" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />} CSV
            </GhostButton>
            <GhostButton data-testid="commission-export-pdf" onClick={() => download("pdf")} disabled={!!exporting || loading} className="!px-3 !py-2 text-xs">
              {exporting === "pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} PDF
            </GhostButton>
            <div className="flex items-center gap-2" data-testid="commission-week-nav">
              <GhostButton data-testid="commission-prev-week" onClick={() => setOffset((o) => o + 1)} className="!px-3 !py-2 text-xs"><ChevronLeft className="h-3.5 w-3.5" /> Older</GhostButton>
              <GhostButton data-testid="commission-next-week" onClick={() => setOffset((o) => Math.max(0, o - 1))} disabled={offset === 0} className="!px-3 !py-2 text-xs">Newer <ChevronRight className="h-3.5 w-3.5" /></GhostButton>
            </div>
          </div>
        }
      />

      {loading ? (
        <Spinner label="Loading commission report…" />
      ) : (
        <>
          <p className="mb-4 text-sm font-semibold text-slate-500" data-testid="commission-week-label">
            Week of {data.week_start} → {data.week_end}{offset === 0 ? " (current)" : offset === 1 ? " (last week)" : ` (${offset} weeks ago)`}
          </p>

          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard icon={Coins} label="Total Bets" value={fmt(t.bets)} accent="sky" testid="commission-total-bets" />
            <StatCard icon={TrendingDown} label="Total Payouts" value={fmt(t.payouts)} accent="amber" testid="commission-total-payouts" />
            <StatCard icon={Landmark} label="House Commission" value={fmt(t.commission)} sub={`${t.rounds} rounds`} accent="green" testid="commission-total-commission" />
            <StatCard icon={Landmark} label={user?.role === "ADMIN" ? "Your Share" : "Admin Share"} value={fmt(t.admin_share)} sub={`SA share ${fmt(t.super_admin_share)}`} accent="sky" testid="commission-sa-share" />
          </div>

          {trend.length > 0 && <div className="mb-6"><TrendChart points={trend} /></div>}

          {(!data.games || data.games.length === 0) ? (
            <EmptyState testid="commission-empty" title="No game activity this week" subtitle="Commission from cash card/number games will appear here as rounds settle." />
          ) : (
            <div className={`${CARD} overflow-hidden`}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm" data-testid="commission-table">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className={thCls}>Game</th>
                      <th className={`${thCls} text-right`}>Bets</th>
                      <th className={`${thCls} text-right`}>Payouts</th>
                      <th className={`${thCls} text-right`}>Commission (70%)</th>
                      <th className={`${thCls} text-right`}>Rounds</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.games.map((g) => {
                      const Icon = GAME_META[g.game_type]?.icon || Coins;
                      return (
                        <Fragment key={g.game_type}>
                          <tr data-testid={`commission-row-${g.game_type}`} className="transition-colors hover:bg-slate-50">
                            <td className={tdCls}><span className="flex items-center gap-2 font-bold text-slate-900"><Icon className="h-4 w-4 text-slate-400" /> {gameLabel(g.game_type)}</span></td>
                            <td className={`${tdCls} text-right`}>{fmt(g.bets)}</td>
                            <td className={`${tdCls} text-right`}>{fmt(g.payouts)}</td>
                            <td className={`${tdCls} text-right font-black text-emerald-600`}>{fmt(g.commission)}</td>
                            <td className={`${tdCls} text-right`}>{g.rounds}</td>
                          </tr>
                          {(g.bet_types || []).map((b) => (
                            <tr key={`${g.game_type}-${b.bet_type}`} data-testid={`commission-bettype-${g.game_type}-${b.bet_type}`} className="bg-slate-50/60 text-xs">
                              <td className={`${tdCls} pl-10 text-slate-500`}>↳ {b.bet_type}</td>
                              <td className={`${tdCls} text-right text-slate-500`}>{fmt(b.bets)}</td>
                              <td className={`${tdCls} text-right text-slate-500`}>{fmt(b.payouts)}</td>
                              <td className={`${tdCls} text-right text-slate-500`}>{fmt(b.commission)}</td>
                              <td className={`${tdCls} text-right text-slate-500`}>{b.rounds}</td>
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
