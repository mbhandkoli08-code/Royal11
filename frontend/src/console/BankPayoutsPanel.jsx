import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Pencil, Download, ArrowUp, ArrowDown, AlertTriangle, FileSpreadsheet, Users } from "lucide-react";
import { useConsoleApi, fmtCoins } from "@/console/api";
import { PanelHeader, Field, PrimaryButton, GhostButton, Spinner, Modal, CARD, thCls, tdCls } from "@/console/primitives";

const FIELD_LABELS = {
  beneficiary_name: "Beneficiary Name", account_number: "Account Number", ifsc: "IFSC Code",
  amount: "Amount", mode: "Payment Mode", remarks: "Remarks",
};
const FIELDS = Object.keys(FIELD_LABELS);

const blankTemplate = () => ({
  name: "", bank_code: "", is_starter: false,
  columns: [{ header: "Beneficiary Name", field: "beneficiary_name" }, { header: "Account Number", field: "account_number" }, { header: "IFSC Code", field: "ifsc" }, { header: "Amount", field: "amount" }],
});

export const BankPayoutsPanel = () => {
  const api = useConsoleApi();
  const [templates, setTemplates] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // template object being edited (null=closed)
  const [saving, setSaving] = useState(false);
  const [exportTemplate, setExportTemplate] = useState("");
  const [selected, setSelected] = useState({}); // admin_id -> {checked, amount, remarks}
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, a] = await Promise.all([
        api.get("/superadmin/payouts/templates"),
        api.get("/superadmin/payouts/admins"),
      ]);
      setTemplates(t.data); setAdmins(a.data);
      if (!exportTemplate && t.data.length) setExportTemplate(t.data[0].id);
    } catch { toast.error("Couldn't load payout templates"); } finally { setLoading(false); }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  // ---- template editor ----
  const saveTemplate = async () => {
    if (!editing.name.trim()) return toast.error("Give the template a name");
    if (!editing.columns.length) return toast.error("Add at least one column");
    setSaving(true);
    try {
      const body = { name: editing.name, bank_code: editing.bank_code, columns: editing.columns.map((c) => ({ header: c.header, field: c.field })) };
      if (editing.id) await api.put(`/superadmin/payouts/templates/${editing.id}`, body);
      else await api.post("/superadmin/payouts/templates", body);
      toast.success("Template saved");
      setEditing(null); await load();
    } catch (e) { toast.error("Couldn't save", { description: e.response?.data?.detail || "" }); }
    finally { setSaving(false); }
  };

  const deleteTemplate = async (id) => {
    try { await api.delete(`/superadmin/payouts/templates/${id}`); toast.success("Template deleted"); await load(); }
    catch { toast.error("Couldn't delete"); }
  };

  const updCol = (i, patch) => setEditing((e) => ({ ...e, columns: e.columns.map((c, idx) => idx === i ? { ...c, ...patch } : c) }));
  const moveCol = (i, dir) => setEditing((e) => {
    const cols = [...e.columns]; const j = i + dir;
    if (j < 0 || j >= cols.length) return e;
    [cols[i], cols[j]] = [cols[j], cols[i]]; return { ...e, columns: cols };
  });
  const addCol = () => setEditing((e) => ({ ...e, columns: [...e.columns, { header: "Remarks", field: "remarks" }] }));
  const rmCol = (i) => setEditing((e) => ({ ...e, columns: e.columns.filter((_, idx) => idx !== i) }));

  // ---- assignment ----
  const assign = async (admin_id, template_id) => {
    try {
      await api.post("/superadmin/payouts/assign", { admin_id, template_id: template_id || null });
      setAdmins((prev) => prev.map((a) => a.admin_id === admin_id ? { ...a, bank_template_id: template_id || null } : a));
      toast.success("Template assigned");
    } catch { toast.error("Couldn't assign"); }
  };

  // ---- bulk export ----
  const toggle = (id) => setSelected((s) => ({ ...s, [id]: { ...(s[id] || { amount: "", remarks: "" }), checked: !s[id]?.checked } }));
  const setField = (id, k, v) => setSelected((s) => ({ ...s, [id]: { ...(s[id] || { checked: true }), [k]: v } }));

  const exportCsv = async () => {
    const beneficiaries = admins.filter((a) => selected[a.admin_id]?.checked)
      .map((a) => ({ admin_id: a.admin_id, amount: Number(selected[a.admin_id]?.amount) || 0, remarks: selected[a.admin_id]?.remarks || "" }));
    if (!beneficiaries.length) return toast.error("Select at least one beneficiary");
    setExporting(true);
    try {
      const { data } = await api.post("/superadmin/payouts/export", { template_id: exportTemplate, beneficiaries }, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      const link = document.createElement("a"); link.href = url; link.download = "payout.csv"; link.click();
      URL.revokeObjectURL(url);
      toast.success("Payout file exported");
    } catch (e) { toast.error("Couldn't export", { description: e.response?.data?.detail || "" }); }
    finally { setExporting(false); }
  };

  if (loading) return <Spinner label="Loading payout templates…" />;

  return (
    <div data-testid="bank-payouts-panel">
      <PanelHeader title="Bank Payout Templates" subtitle="Editable per-bank bulk-upload formats for paying Admins (reversals, refunds, batch payouts)." />

      <div className="mb-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        Starter templates follow the common Indian-bank pattern but were <b>not verified against live bank documentation</b>. Confirm each bank&apos;s current bulk-upload format before first real use, and edit columns/headers here as needed.
      </div>

      {/* Templates library */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="templates-grid">
        {templates.map((t) => (
          <div key={t.id} className={`${CARD} p-4`} data-testid={`template-${t.bank_code}`}>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-bold text-slate-900">{t.name}</p>
                <p className="text-[11px] text-slate-400">{t.bank_code} · {t.columns.length} columns {t.is_starter && <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">starter — verify</span>}</p>
              </div>
              <div className="flex gap-1">
                <button data-testid={`template-edit-${t.id}`} onClick={() => setEditing({ ...t, columns: t.columns.map((c) => ({ ...c })) })} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><Pencil className="h-3.5 w-3.5" /></button>
                <button data-testid={`template-delete-${t.id}`} onClick={() => deleteTemplate(t.id)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-rose-500 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
            <p className="mt-2 truncate text-[11px] text-slate-500">{t.columns.map((c) => c.header).join(" · ")}</p>
          </div>
        ))}
        <button data-testid="template-new" onClick={() => setEditing(blankTemplate())} className={`${CARD} flex items-center justify-center gap-2 p-4 text-sm font-bold text-sky-600 hover:bg-sky-50`}>
          <Plus className="h-4 w-4" /> New template
        </button>
      </div>

      {/* Bulk export builder */}
      <div className={`${CARD} p-5`} data-testid="bulk-export-card">
        <p className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900"><FileSpreadsheet className="h-4 w-4 text-sky-600" /> Bulk payout export</p>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-500">Export in bank format</span>
            <select data-testid="export-template-select" value={exportTemplate} onChange={(e) => setExportTemplate(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-400">
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <PrimaryButton data-testid="export-payout-csv" onClick={exportCsv} disabled={exporting} className="ml-auto">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export CSV
          </PrimaryButton>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm" data-testid="payout-admins-table">
            <thead><tr className="border-b border-slate-100 bg-slate-50/60">
              <th className={thCls}></th><th className={thCls}>Admin</th><th className={thCls}>Beneficiary</th>
              <th className={thCls}>Account</th><th className={thCls}>Assigned template</th><th className={thCls}>Amount ₹</th><th className={thCls}>Remarks</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {admins.map((a) => (
                <tr key={a.admin_id} data-testid={`payout-admin-${a.admin_id}`} className="hover:bg-slate-50">
                  <td className={tdCls}><input data-testid={`payout-check-${a.admin_id}`} type="checkbox" checked={!!selected[a.admin_id]?.checked} onChange={() => toggle(a.admin_id)} /></td>
                  <td className={`${tdCls} font-semibold text-slate-900`}>{a.name}</td>
                  <td className={`${tdCls} text-xs text-slate-500`}>{a.beneficiary_name || "—"}</td>
                  <td className={`${tdCls} text-xs text-slate-500`}>{a.account_number || <span className="text-amber-600">no bank</span>}</td>
                  <td className={tdCls}>
                    <select data-testid={`assign-${a.admin_id}`} value={a.bank_template_id || ""} onChange={(e) => assign(a.admin_id, e.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-sky-400">
                      <option value="">— none —</option>
                      {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </td>
                  <td className={tdCls}><input data-testid={`payout-amount-${a.admin_id}`} type="number" value={selected[a.admin_id]?.amount || ""} onChange={(e) => setField(a.admin_id, "amount", e.target.value)} className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-sky-400" placeholder="0" /></td>
                  <td className={tdCls}><input data-testid={`payout-remarks-${a.admin_id}`} value={selected[a.admin_id]?.remarks || ""} onChange={(e) => setField(a.admin_id, "remarks", e.target.value)} className="w-40 rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-sky-400" placeholder="e.g. refund" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Template editor modal */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Edit template" : "New template"} testid="template-editor">
        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Template name" data-testid="tmpl-name" value={editing.name} onChange={(e) => setEditing((x) => ({ ...x, name: e.target.value }))} placeholder="e.g. Kotak Bank" />
              <Field label="Bank code" data-testid="tmpl-code" value={editing.bank_code} onChange={(e) => setEditing((x) => ({ ...x, bank_code: e.target.value }))} placeholder="KOTAK" />
            </div>
            <p className="text-xs font-semibold text-slate-500">Columns (order = file column order)</p>
            <div className="space-y-2" data-testid="tmpl-columns">
              {editing.columns.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input data-testid={`tmpl-col-header-${i}`} value={c.header} onChange={(e) => updCol(i, { header: e.target.value })} className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-sky-400" placeholder="Header text" />
                  <select data-testid={`tmpl-col-field-${i}`} value={c.field} onChange={(e) => updCol(i, { field: e.target.value })} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-sky-400">
                    {FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABELS[f]}</option>)}
                  </select>
                  <button onClick={() => moveCol(i, -1)} className="grid h-7 w-7 place-items-center rounded border border-slate-200 text-slate-400 hover:bg-slate-50"><ArrowUp className="h-3 w-3" /></button>
                  <button onClick={() => moveCol(i, 1)} className="grid h-7 w-7 place-items-center rounded border border-slate-200 text-slate-400 hover:bg-slate-50"><ArrowDown className="h-3 w-3" /></button>
                  <button data-testid={`tmpl-col-rm-${i}`} onClick={() => rmCol(i)} className="grid h-7 w-7 place-items-center rounded border border-slate-200 text-rose-500 hover:bg-rose-50"><Trash2 className="h-3 w-3" /></button>
                </div>
              ))}
            </div>
            <GhostButton data-testid="tmpl-add-col" onClick={addCol}><Plus className="h-3.5 w-3.5" /> Add column</GhostButton>
            <PrimaryButton data-testid="tmpl-save" onClick={saveTemplate} disabled={saving} className="w-full">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save template"}
            </PrimaryButton>
          </div>
        )}
      </Modal>
    </div>
  );
};
