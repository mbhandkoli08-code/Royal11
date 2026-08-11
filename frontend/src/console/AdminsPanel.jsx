import { useCallback, useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { toast } from "sonner";
import { useConsoleApi, fmtCoins, shortId } from "./api";
import {
  CARD, thCls, tdCls, PanelHeader, StatusBadge, UsageBar, Spinner, EmptyState,
} from "./primitives";

// Super Admin view of every Admin. Read-only: coin allocation to an Admin flows
// through their Manager (Manager → My Admins → Allocate), preserving the quota
// model, so there's no SA-direct-allocate that would bypass the economy.
export const AdminsPanel = ({ query = "" }) => {
  const api = useConsoleApi();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/admins");
      setRows(data);
    } catch {
      toast.error("Couldn't load admins");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.user.display_name.toLowerCase().includes(q) ||
      r.user.email.toLowerCase().includes(q) ||
      (r.manager_name || "").toLowerCase().includes(q) ||
      r.user.id.includes(q));
  }, [rows, query]);

  return (
    <div data-testid="admins-panel">
      <PanelHeader title="Admins" subtitle={`${rows.length} admin${rows.length === 1 ? "" : "s"} across all managers`} />

      <div className="mb-4 flex items-center gap-2 rounded-xl border border-[rgba(212,175,55,0.15)] bg-[#1b1012] px-4 py-3 text-xs text-[#a3999b]">
        <Info className="h-4 w-4 shrink-0 text-[#d4af37]" />
        Coins are allocated to an Admin by their Manager. Sign in as the Manager to allocate.
      </div>

      {loading ? <Spinner label="Loading admins…" /> : filtered.length === 0 ? (
        <EmptyState testid="admins-empty" title="No admins found" subtitle="Admins appear here once a Manager creates them." />
      ) : (
        <div className={`${CARD} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm" data-testid="admins-table">
              <thead>
                <tr className="border-b border-white/5">
                  <th className={thCls}>Admin</th>
                  <th className={thCls}>Manager</th>
                  <th className={thCls}>Allocated</th>
                  <th className={thCls}>Used</th>
                  <th className={thCls}>Remaining</th>
                  <th className={thCls}>Usage</th>
                  <th className={thCls}>Players</th>
                  <th className={thCls}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filtered.map((r) => (
                  <tr key={r.user.id} data-testid={`admin-row-${r.user.id}`} className="transition-colors hover:bg-white/[0.02]">
                    <td className={tdCls}>
                      <p className="font-bold text-white">{r.user.display_name}</p>
                      <p className="text-[11px] text-[#8c8385]">{r.user.email}</p>
                      <p className="font-mono text-[11px] text-[#8c8385]">{shortId(r.user.id)}</p>
                    </td>
                    <td className={tdCls}>{r.manager_name}</td>
                    <td className={`${tdCls} text-[#d4af37]`}>{fmtCoins(r.allocated)}</td>
                    <td className={tdCls}>{fmtCoins(r.used)}</td>
                    <td className={tdCls}>{fmtCoins(r.remaining)}</td>
                    <td className={tdCls}><UsageBar pct={r.usage_pct} /></td>
                    <td className={tdCls}>{r.player_count}<span className="text-[#8c8385]"> / {r.player_capacity}</span></td>
                    <td className={tdCls}><StatusBadge status={r.user.status} /></td>
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
