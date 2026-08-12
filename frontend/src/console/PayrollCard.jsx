import { useCallback, useEffect, useState } from "react";
import { Wallet2, Target, TrendingUp, BadgeIndianRupee } from "lucide-react";
import { useConsoleApi, fmtCoins } from "./api";
import { CARD, Spinner } from "./primitives";

// Manager / Zonal Manager weekly pay: guaranteed salary + performance incentive.
export const PayrollCard = ({ endpoint }) => {
  const api = useConsoleApi();
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { const { data } = await api.get(endpoint); setD(data); }
    catch { /* keep silent — the rest of the console still works */ }
    finally { setLoading(false); }
  }, [api, endpoint]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Spinner label="Loading pay…" />;
  if (!d) return null;

  const hasSalary = d.weekly_salary_inr > 0;
  const hasIncentive = d.incentive_target_inr > 0;
  if (!hasSalary && !hasIncentive) {
    return (
      <div className={`${CARD} mb-8 p-5`} data-testid="payroll-card">
        <p className="text-sm text-slate-500">No weekly salary or incentive is set for you yet. Your Super Admin can configure this.</p>
      </div>
    );
  }
  const pct = hasIncentive ? Math.min(100, Math.round((d.current_week_revenue_inr / d.incentive_target_inr) * 100)) : 0;

  return (
    <div className={`${CARD} mb-8 p-5`} data-testid="payroll-card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-display text-base font-bold text-slate-900"><BadgeIndianRupee className="h-5 w-5 text-sky-600" /> This week's pay</h3>
        <span className="text-[11px] text-slate-400">{d.week_start} → {d.week_end}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl bg-slate-50 px-3 py-2.5">
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400"><Wallet2 className="h-3 w-3" /> Salary (guaranteed)</p>
          <p className="font-display text-lg font-bold text-slate-900" data-testid="payroll-salary">₹{fmtCoins(d.weekly_salary_inr)}</p>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2.5">
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400"><Target className="h-3 w-3" /> Target</p>
          <p className="font-display text-lg font-bold text-slate-900">{hasIncentive ? `₹${fmtCoins(d.incentive_target_inr)}` : "—"}</p>
          {hasIncentive && <p className="text-[10px] text-slate-400">{d.incentive_pct}% bonus</p>}
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2.5">
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400"><TrendingUp className="h-3 w-3" /> Incentive {d.target_met ? "(earned)" : "(projected)"}</p>
          <p className={`font-display text-lg font-bold ${d.target_met ? "text-emerald-600" : "text-slate-900"}`} data-testid="payroll-incentive">₹{fmtCoins(d.projected_incentive_inr)}</p>
        </div>
        <div className="rounded-xl bg-sky-50 px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-500">Total this week</p>
          <p className="font-display text-lg font-extrabold text-sky-700" data-testid="payroll-total">₹{fmtCoins(d.projected_total_inr)}</p>
        </div>
      </div>
      {hasIncentive && (
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-slate-500">Downline revenue: <b className="text-slate-800">₹{fmtCoins(d.current_week_revenue_inr)}</b> of ₹{fmtCoins(d.incentive_target_inr)}</span>
            <span className={`font-semibold ${d.target_met ? "text-emerald-600" : "text-slate-400"}`}>{d.target_met ? "Target met 🎉" : `${pct}%`}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full transition-all ${d.target_met ? "bg-emerald-500" : "bg-sky-500"}`} style={{ width: `${pct}%` }} data-testid="payroll-progress" />
          </div>
        </div>
      )}

      {d.payslips?.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4" data-testid="payslip-history">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Recent payslips</p>
          <div className="overflow-hidden rounded-xl border border-slate-100">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-semibold">Week of</th>
                  <th className="px-3 py-2 text-right font-semibold">Salary</th>
                  <th className="px-3 py-2 text-right font-semibold">Incentive</th>
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {d.payslips.map((s) => (
                  <tr key={s.week_start} data-testid={`payslip-${s.week_start}`}>
                    <td className="px-3 py-2 text-slate-600">{s.week_start}</td>
                    <td className="px-3 py-2 text-right text-slate-700">₹{fmtCoins(s.salary_inr)}</td>
                    <td className="px-3 py-2 text-right text-emerald-600">₹{fmtCoins(s.incentive_inr)}</td>
                    <td className="px-3 py-2 text-right font-bold text-slate-900">₹{fmtCoins(s.total_inr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
