import { useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, Search, Eye, Loader2 } from "lucide-react";
import { useConsoleApi, fmtDate } from "@/console/api";
import { CARD, PanelHeader, EmptyState, Modal } from "@/console/primitives";

// SUPER-ADMIN ONLY. Masked player payout/contact lookup with an explicit
// reveal that is audit-logged server-side. No lower role can reach these APIs.
export const PlayerPayoutPanel = () => {
  const api = useConsoleApi();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [reveal, setReveal] = useState(null);
  const [revealing, setRevealing] = useState(false);

  const search = async () => {
    setLoading(true); setSearched(true);
    try { const { data } = await api.get(`/admin/players/lookup?q=${encodeURIComponent(q)}`); setRows(data); }
    catch { toast.error("Lookup failed"); }
    setLoading(false);
  };

  const doReveal = async (id) => {
    setRevealing(true); setReveal({ loading: true });
    try { const { data } = await api.get(`/admin/players/${id}/sensitive`); setReveal(data); }
    catch { toast.error("Reveal failed"); setReveal(null); }
    setRevealing(false);
  };

  return (
    <div data-testid="player-payout-panel">
      <PanelHeader title="Player Payout Details" subtitle="Super-Admin-only. Contact & bank/UPI are private to each player — reveals are audit-logged." />

      <div className={`${CARD} p-4`}>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input data-testid="payout-search" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()} placeholder="Search players by name or email…"
              className="w-full rounded-full border border-slate-200 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-sky-400" />
          </div>
          <button data-testid="payout-search-btn" onClick={search}
            className="rounded-full bg-sky-500 px-5 text-sm font-semibold text-white hover:bg-sky-600">Search</button>
        </div>
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="flex justify-center py-16 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : !searched ? (
          <p className="py-10 text-center text-sm text-slate-400">Search to view players (details stay masked until you reveal).</p>
        ) : rows.length === 0 ? (
          <EmptyState title="No players found" testid="payout-empty" />
        ) : (
          <div className={`${CARD} overflow-hidden`}>
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr><th className="px-4 py-3">Player</th><th className="px-4 py-3">Mobile</th><th className="px-4 py-3">Bank a/c</th><th className="px-4 py-3">UPI</th><th className="px-4 py-3">Opt-in</th><th className="px-4 py-3"></th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-testid={`payout-row-${r.id}`} className="border-t border-slate-100">
                    <td className="px-4 py-3"><p className="font-semibold text-slate-900">{r.display_name}</p><p className="text-xs text-slate-400">{r.email}</p></td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">{r.mobile_masked || "—"}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">{r.bank_masked || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{r.upi_masked || "—"}</td>
                    <td className="px-4 py-3">{r.marketing_opt_in ? <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">YES</span> : <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">NO</span>}</td>
                    <td className="px-4 py-3 text-right">
                      <button data-testid={`payout-reveal-${r.id}`} disabled={revealing} onClick={() => doReveal(r.id)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-bold text-sky-700 hover:bg-sky-50 disabled:opacity-50">
                        <Eye className="h-3.5 w-3.5" /> Reveal
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={!!reveal} onClose={() => setReveal(null)} title="Player payout details" testid="payout-reveal-modal">
        {reveal?.loading ? (
          <div className="flex justify-center py-8 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : reveal ? (
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-700">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> This reveal has been recorded in the audit log.
            </div>
            <Row label="Player" value={`${reveal.player.display_name} · ${reveal.player.email}`} />
            <Row label="Mobile" value={reveal.profile.mobile} />
            <Row label="Account holder" value={reveal.profile.bank?.account_holder_name} />
            <Row label="Account number" value={reveal.profile.bank?.account_number} />
            <Row label="IFSC" value={reveal.profile.bank?.ifsc} />
            <Row label="Bank" value={reveal.profile.bank?.bank_name} />
            <Row label="UPI ID" value={reveal.profile.upi_id} />
            <Row label="Marketing opt-in" value={reveal.profile.consent?.marketing_opt_in ? `Yes (SMS:${reveal.profile.consent.sms?"on":"off"}, WA:${reveal.profile.consent.whatsapp?"on":"off"}, Push:${reveal.profile.consent.push?"on":"off"})` : "No"} />
            <Row label="Consent updated" value={reveal.profile.consent_updated_at ? fmtDate(reveal.profile.consent_updated_at) : "—"} />
          </div>
        ) : null}
      </Modal>
    </div>
  );
};

const Row = ({ label, value }) => (
  <div className="flex items-center justify-between border-b border-slate-100 py-1.5">
    <span className="text-xs font-semibold text-slate-500">{label}</span>
    <span className="text-right font-semibold text-slate-900">{value || "—"}</span>
  </div>
);
