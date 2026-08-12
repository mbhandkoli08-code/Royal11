import { useCallback, useEffect, useState } from "react";
import { ShieldAlert, Check, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useConsoleApi, fmtDate } from "./api";
import { CARD, thCls, tdCls, PanelHeader, GhostButton, StatusBadge, Spinner, EmptyState } from "./primitives";

// Super Admin: accounts that recently hit a brute-force login lockout.
export const SecurityPanel = () => {
  const api = useConsoleApi();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try { const { data } = await api.get("/admin/security/login-alerts"); setRows(data); }
    catch { toast.error("Couldn't load security alerts"); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const resolve = async (email) => {
    setBusy(email);
    try {
      await api.post("/admin/security/login-alerts/resolve", { email });
      toast.success("Alert resolved — lockout cleared");
      await load();
    } catch (e) { toast.error("Couldn't resolve", { description: e.response?.data?.detail || "" }); }
    finally { setBusy(""); }
  };

  if (loading) return <Spinner label="Loading security alerts…" />;

  return (
    <div data-testid="security-panel">
      <PanelHeader
        title="Login Security"
        subtitle="Accounts that recently triggered a brute-force lockout (5+ failed attempts). Resolving clears the temporary lock."
        actions={<GhostButton data-testid="security-refresh" onClick={load} className="!px-3 !py-2 text-xs"><RefreshCw className="h-3.5 w-3.5" /> Refresh</GhostButton>}
      />
      {rows.length === 0 ? (
        <EmptyState testid="security-empty" title="No suspicious activity" subtitle="Login lockouts will appear here if an account is repeatedly targeted." />
      ) : (
        <div className={`${CARD} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm" data-testid="security-table">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className={thCls}>Account</th>
                  <th className={thCls}>Last IP</th>
                  <th className={thCls}>Lockouts</th>
                  <th className={thCls}>Last locked</th>
                  <th className={thCls}>Status</th>
                  <th className={`${thCls} text-right`}>Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((a) => (
                  <tr key={a.email} data-testid={`security-row-${a.email}`} className="transition-colors hover:bg-slate-50">
                    <td className={tdCls}>
                      <p className="flex items-center gap-2 font-bold text-slate-900"><ShieldAlert className="h-4 w-4 text-rose-500" /> {a.display_name || a.email}</p>
                      <p className="text-[11px] text-slate-400">{a.email}{a.role ? ` · ${a.role}` : " · unknown account"}</p>
                    </td>
                    <td className={`${tdCls} font-mono text-xs`}>{a.last_ip || "—"}</td>
                    <td className={tdCls}>{a.lock_count}</td>
                    <td className={`${tdCls} text-xs text-slate-400`}>{fmtDate(a.last_locked_at)}</td>
                    <td className={tdCls}><StatusBadge status={a.resolved ? "COMPLETED" : "PENDING"} /></td>
                    <td className={tdCls}>
                      <div className="flex justify-end">
                        <GhostButton data-testid={`security-resolve-${a.email}`} disabled={busy === a.email || a.resolved} onClick={() => resolve(a.email)} className="!px-3 !py-2 text-xs">
                          {busy === a.email ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Resolve
                        </GhostButton>
                      </div>
                    </td>
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
