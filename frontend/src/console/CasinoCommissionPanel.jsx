import { useCallback, useEffect, useState, Fragment } from "react";
import { Coins, TrendingDown, Landmark, ChevronLeft, ChevronRight, Layers, Spade, HandCoins } from "lucide-react";
import { toast } from "sonner";
import { useConsoleApi } from "./api";
import { CARD, thCls, tdCls, PanelHeader, StatCard, Spinner, EmptyState, GhostButton } from "./primitives";

const GAME_META = {
  rummy_points: { label: "Points Rummy", icon: Layers },
  high_card: { label: "High Card", icon: Spade },
  thane_matka: { label: "Thane Matka", icon: HandCoins },
};
const gameLabel = (gt) => GAME_META[gt]?.label || gt;
const fmt = (n) => (n || 0).toLocaleString();

// Super Admin: automatic weekly rollup of the 70% house commission already
// recorded per-round in casino_rake_ledger (no manual calculation).
export const CasinoCommissionPanel = () => {
  const api = useConsoleApi();
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.get(`/casino/admin/commission-report?week_offset=${offset}`); setData(data); }
    catch { toast.error("Couldn't load commission report"); }
    finally { setLoading(false); }
  }, [api, offset]);
  useEffect(() => { load(); }, [load]);

  const t = data?.totals;
  return (
    <div data-testid="casino-commission-panel">
      <PanelHeader
        title="Casino Commission"
        subtitle="Weekly house-commission rollup across all card & number games — summed automatically from the per-round rake ledger. Sun–Sat weeks."
        actions={
          <div className="flex items-center gap-2" data-testid="commission-week-nav">
            <GhostButton data-testid="commission-prev-week" onClick={() => setOffset((o) => o + 1)} className="!px-3 !py-2 text-xs"><ChevronLeft className="h-3.5 w-3.5" /> Older</GhostButton>
            <GhostButton data-testid="commission-next-week" onClick={() => setOffset((o) => Math.max(0, o - 1))} disabled={offset === 0} className="!px-3 !py-2 text-xs">Newer <ChevronRight className="h-3.5 w-3.5" /></GhostButton>
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
            <StatCard icon={Landmark} label="Super Admin Share" value={fmt(t.super_admin_share)} sub={`Admin share ${fmt(t.admin_share)}`} accent="sky" testid="commission-sa-share" />
          </div>

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
