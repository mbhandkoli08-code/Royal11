import { useCallback, useEffect, useState } from "react";
import { Plus, Loader2, Trophy, Scale, XCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useConsoleApi, fmtCoins, fmtDate, shortId } from "./api";
import { CARD, PanelHeader, PrimaryButton, GhostButton, StatusBadge, Modal, Field, Spinner, EmptyState } from "./primitives";

const EMPTY = { fixture_id: "", name: "", entry_fee: 50, max_participants: 100, prize_pool: 5000 };

// Admin/Super Admin: create fantasy contests on real Sportmonks fixtures + manage settlement.
export const FantasyPanel = () => {
  const api = useConsoleApi();
  const { user } = useAuth();
  const isSA = user?.role === "SUPER_ADMIN";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const load = useCallback(async () => {
    try { const { data } = await api.get("/admin/fantasy/contests"); setRows(data); }
    catch { toast.error("Couldn't load contests"); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (busy) return;
    if (!form.fixture_id.trim()) return toast.error("Enter a Sportmonks fixture ID");
    setBusy(true);
    try {
      await api.post("/admin/fantasy/contests", {
        fixture_id: form.fixture_id.trim(), name: form.name.trim() || "Fantasy Contest",
        entry_fee: Number(form.entry_fee) || 0, max_participants: Number(form.max_participants) || 1,
        prize_pool: Number(form.prize_pool) || 0,
      });
      toast.success("Contest created"); setModal(false); setForm(EMPTY); await load();
    } catch (e) { toast.error("Couldn't create", { description: e.response?.data?.detail || "" }); }
    finally { setBusy(false); }
  };

  const settle = async (c) => {
    setBusy(true);
    try { const { data } = await api.post(`/admin/fantasy/contests/${c.id}/settle`); toast.success(`Settled — ${data.teams_scored ?? 0} teams scored`); await load(); }
    catch (e) { toast.error("Not settled", { description: e.response?.data?.detail || "Match data may not be final yet." }); }
    finally { setBusy(false); }
  };
  const cancel = async (c) => {
    setBusy(true);
    try { await api.post(`/admin/fantasy/contests/${c.id}/cancel`); toast.success("Cancelled + entries refunded"); await load(); }
    catch (e) { toast.error("Couldn't cancel", { description: e.response?.data?.detail || "" }); }
    finally { setBusy(false); }
  };

  return (
    <div data-testid="fantasy-panel">
      <PanelHeader
        title="Fantasy Contests"
        subtitle="Create contests on real Sportmonks fixtures. Winners are paid automatically after the match from real stats."
        actions={<PrimaryButton data-testid="fantasy-create-btn" onClick={() => { setForm(EMPTY); setModal(true); }}><Plus className="h-4 w-4" /> Create Contest</PrimaryButton>}
      />
      {loading ? <Spinner label="Loading contests…" /> : rows.length === 0 ? (
        <EmptyState testid="fantasy-empty" title="No contests yet" subtitle="Create one against a real upcoming fixture to get started." />
      ) : (
        <div className="space-y-3" data-testid="fantasy-contest-list">
          {rows.map((c) => (
            <div key={c.id} data-testid={`fantasy-contest-${c.id}`} className={`${CARD} p-5`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 font-bold text-slate-900"><Trophy className="h-4 w-4 text-sky-500" /> {c.name}<span className="font-mono text-[11px] font-normal text-slate-400">{shortId(c.id)}</span></p>
                  <p className="mt-1 text-xs text-slate-500">{c.match_label} · fixture {c.fixture_id}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">Entry ₹{fmtCoins(c.entry_fee)} · Pool {fmtCoins(c.prize_pool)} coins · {c.participant_count}/{c.max_participants} joined · locks {fmtDate(c.lock_at)}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <StatusBadge status={c.status} />
                  {isSA && c.status !== "SETTLED" && c.status !== "CANCELLED" && (
                    <div className="flex gap-2">
                      <GhostButton data-testid={`settle-${c.id}`} disabled={busy} onClick={() => settle(c)} className="!px-3 !py-2 text-xs"><Scale className="h-3.5 w-3.5" /> Settle</GhostButton>
                      <GhostButton data-testid={`cancel-${c.id}`} disabled={busy} onClick={() => cancel(c)} className="!px-3 !py-2 text-xs"><XCircle className="h-3.5 w-3.5" /> Cancel</GhostButton>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title="Create fantasy contest" testid="fantasy-create-modal">
        <div className="space-y-4">
          <p className="text-xs text-slate-400">The fixture must be a real Sportmonks match with an available squad/lineup. Find fixture IDs on the Sports data.</p>
          <Field label="Sportmonks fixture ID" data-testid="fc-fixture" value={form.fixture_id} onChange={(e) => setForm((f) => ({ ...f, fixture_id: e.target.value }))} placeholder="e.g. 123456" />
          <Field label="Contest name" data-testid="fc-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Mega Contest" />
          <div className="grid grid-cols-3 gap-4">
            <Field label="Entry fee (coins)" type="number" data-testid="fc-entry" value={form.entry_fee} onChange={(e) => setForm((f) => ({ ...f, entry_fee: e.target.value }))} />
            <Field label="Max players" type="number" data-testid="fc-max" value={form.max_participants} onChange={(e) => setForm((f) => ({ ...f, max_participants: e.target.value }))} />
            <Field label="Prize pool" type="number" data-testid="fc-pool" value={form.prize_pool} onChange={(e) => setForm((f) => ({ ...f, prize_pool: e.target.value }))} />
          </div>
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">Default prize split: 50% / 30% / 20% to the top 3.</p>
          <PrimaryButton data-testid="fc-submit" onClick={create} disabled={busy} className="w-full">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create Contest</PrimaryButton>
        </div>
      </Modal>
    </div>
  );
};
