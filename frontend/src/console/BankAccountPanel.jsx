import { useCallback, useEffect, useState } from "react";
import { Loader2, Save, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useConsoleApi } from "./api";
import { CARD, PanelHeader, PrimaryButton, Field, Spinner } from "./primitives";

const EMPTY = { account_holder_name: "", account_number: "", ifsc: "", bank_name: "", is_active: true };

// Admin/Manager manage their own collection bank account (manual entry).
export const BankAccountPanel = () => {
  const api = useConsoleApi();
  const { user } = useAuth();
  const suspended = user?.status === "SUSPENDED";
  const [form, setForm] = useState(EMPTY);
  const [existing, setExisting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/bank-account");
      if (data) { setForm({ ...EMPTY, ...data }); setExisting(true); }
    } catch {
      toast.error("Couldn't load bank account");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (busy) return;
    if (!form.account_holder_name || !form.account_number || !form.ifsc || !form.bank_name)
      return toast.error("Please fill all fields");
    setBusy(true);
    try {
      await api.put("/admin/bank-account", {
        account_holder_name: form.account_holder_name.trim(),
        account_number: form.account_number.trim(),
        ifsc: form.ifsc.trim().toUpperCase(),
        bank_name: form.bank_name.trim(),
        is_active: true,
      });
      toast.success("Bank account saved");
      setExisting(true);
    } catch (e) {
      toast.error("Couldn't save", { description: e.response?.data?.detail || "" });
    } finally { setBusy(false); }
  };

  if (loading) return <Spinner label="Loading bank account…" />;

  return (
    <div data-testid="bank-account-panel">
      <PanelHeader title="Collection Bank Account" subtitle="Players see these details when they top up. Manual entry — keep it accurate." />
      <div className={`${CARD} max-w-lg p-6`}>
        {existing && (
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-600">
            <CheckCircle2 className="h-4 w-4" /> Active account on file
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Account holder name" data-testid="bank-holder" value={form.account_holder_name} onChange={set("account_holder_name")} />
          <Field label="Bank name" data-testid="bank-name" value={form.bank_name} onChange={set("bank_name")} />
          <Field label="Account number" data-testid="bank-number" value={form.account_number} onChange={set("account_number")} />
          <Field label="IFSC" data-testid="bank-ifsc" value={form.ifsc} onChange={set("ifsc")} />
        </div>
        <PrimaryButton data-testid="bank-save" onClick={save} disabled={busy || suspended} className="mt-5">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {existing ? "Update Account" : "Save Account"}
        </PrimaryButton>
        {suspended && <p className="mt-3 text-xs text-rose-600">Your account is suspended — editing is disabled until reinstated.</p>}
      </div>
    </div>
  );
};
