import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { KeyRound, Plus, Trash2, Loader2, CheckCircle2, XCircle, RefreshCw, Wallet2 } from "lucide-react";
import { toast } from "sonner";
import { useConsoleApi } from "@/console/api";
import { CARD, PanelHeader, PrimaryButton, GhostButton, Field, Spinner, EmptyState } from "@/console/primitives";

const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
const PROVIDER_LABEL = { openai: "OpenAI", anthropic: "Anthropic", google: "Google (Gemini)", unknown: "Unknown" };

const detectProvider = (key) => {
  const k = (key || "").trim();
  if (k.startsWith("sk-ant-")) return "anthropic";
  if (k.startsWith("AIza")) return "google";
  if (k.startsWith("sk-")) return "openai";
  return "";
};

const relTime = (iso) => {
  if (!iso) return "never";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const statusMeta = (k) => {
  if (k.last_test_status === "failed") return { color: "bg-red-500", label: "Failed" };
  if (k.last_test_status === "ok") {
    const fresh = k.last_tested_at && Date.now() - new Date(k.last_tested_at).getTime() < RECENT_MS;
    return fresh ? { color: "bg-emerald-500", label: "Live" } : { color: "bg-amber-400", label: "Stale — re-test" };
  }
  return { color: "bg-amber-400", label: "Untested" };
};

const ResultLine = ({ result }) => {
  if (!result) return null;
  const ok = result.status === "ok";
  return (
    <div data-testid="key-test-result" className={`mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold ${ok ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
      <span>{result.message}</span>
    </div>
  );
};

const BalanceCell = ({ balance }) => {
  if (!balance) return <span className="text-xs text-[#8c8385]">Not available</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#d4af37]">
      <Wallet2 className="h-3.5 w-3.5" />{balance.amount} {balance.currency}
    </span>
  );
};

export const ApiKeysPanel = () => {
  const api = useConsoleApi();

  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ key: "", provider: "" });
  const [detecting, setDetecting] = useState(false);
  const [providerTouched, setProviderTouched] = useState(false);
  const detectRef = useRef(null);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rowBusy, setRowBusy] = useState({});

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/api-keys");
      setKeys(data);
    } catch {
      toast.error("Couldn't load API keys");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const onKeyChange = (value) => {
    setForm((f) => ({ ...f, key: value }));
    setTestResult(null);
    if (providerTouched) return;
    setDetecting(true);
    if (detectRef.current) clearTimeout(detectRef.current);
    detectRef.current = setTimeout(() => {
      setForm((f) => ({ ...f, provider: detectProvider(f.key) }));
      setDetecting(false);
    }, 400);
  };

  const runTest = async () => {
    if (!form.key.trim() || testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const { data } = await api.post("/admin/api-keys/test", { key: form.key.trim(), provider: form.provider || undefined });
      setTestResult(data);
      if (!form.provider && data.provider) setForm((f) => ({ ...f, provider: data.provider }));
    } catch {
      setTestResult({ status: "failed", message: "Test request failed. Please try again." });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!form.key.trim() || saving) return;
    setSaving(true);
    try {
      await api.post("/admin/api-keys", { key: form.key.trim(), provider: form.provider || undefined });
      toast.success("API key saved securely");
      setForm({ key: "", provider: "" });
      setProviderTouched(false);
      setTestResult(null);
      await load();
    } catch (e) {
      toast.error("Couldn't save key", { description: e.response?.data?.detail || "" });
    } finally {
      setSaving(false);
    }
  };

  const testSaved = async (id) => {
    setRowBusy((b) => ({ ...b, [id]: "test" }));
    try {
      const { data } = await api.post(`/admin/api-keys/${id}/test`, {});
      setKeys((list) => list.map((k) => (k.id === id ? data : k)));
      toast[data.last_test_status === "ok" ? "success" : "error"](
        data.last_test_status === "ok" ? "Key is live" : "Key test failed",
        { description: data.last_test_message });
    } catch {
      toast.error("Test failed");
    } finally {
      setRowBusy((b) => ({ ...b, [id]: undefined }));
    }
  };

  const remove = async (id) => {
    setRowBusy((b) => ({ ...b, [id]: "delete" }));
    try {
      await api.del(`/admin/api-keys/${id}`);
      setKeys((list) => list.filter((k) => k.id !== id));
      toast("Key deleted");
    } catch {
      toast.error("Couldn't delete key");
    } finally {
      setRowBusy((b) => ({ ...b, [id]: undefined }));
    }
  };

  return (
    <div data-testid="apikeys-panel">
      <PanelHeader title="API Keys" subtitle="Provider keys are tested live, then stored encrypted at rest." />

      <section className={`${CARD} p-6`}>
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-[#d4af37]" />
          <h2 className="font-display text-lg font-extrabold tracking-tight text-white">Add an API key</h2>
        </div>
        <p className="mt-1 text-sm text-[#8c8385]">Paste a provider key. We detect the provider, let you test it live, then store it encrypted.</p>

        <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
          <input
            data-testid="apikey-input" type="password" autoComplete="off"
            placeholder="Paste API key (e.g. sk-ant-…, sk-proj-…, AIza…)"
            value={form.key} onChange={(e) => onKeyChange(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-[#0d0d0d] px-4 py-3 text-sm font-medium text-white outline-none transition-colors placeholder:text-[#8c8385] focus:border-[#d4af37]/50"
          />
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[#8c8385]">Provider</span>
            <select
              data-testid="apikey-provider-select" value={form.provider}
              onChange={(e) => { setProviderTouched(true); setForm((f) => ({ ...f, provider: e.target.value })); }}
              className="rounded-xl border border-white/10 bg-[#0d0d0d] px-3 py-3 text-sm font-semibold text-white outline-none focus:border-[#d4af37]/50"
            >
              <option value="">{detecting ? "Detecting…" : "Auto-detect"}</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="google">Google (Gemini)</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>
        </div>

        <ResultLine result={testResult} />

        <div className="mt-4 flex flex-wrap gap-3">
          <GhostButton data-testid="apikey-test-btn" onClick={runTest} disabled={!form.key.trim() || testing}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {testing ? "Testing…" : "Test key"}
          </GhostButton>
          <PrimaryButton data-testid="apikey-save-btn" onClick={save} disabled={!form.key.trim() || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Save key
          </PrimaryButton>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-4 font-display text-lg font-extrabold tracking-tight text-white">Saved keys</h2>
        {loading ? (
          <Spinner label="Loading keys…" />
        ) : keys.length === 0 ? (
          <EmptyState testid="apikey-empty" title="No API keys yet" subtitle="Add one above to get started." />
        ) : (
          <div className="space-y-3" data-testid="apikey-list">
            {keys.map((k) => {
              const s = statusMeta(k);
              const busy = rowBusy[k.id];
              return (
                <motion.div key={k.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  data-testid={`apikey-row-${k.id}`} className={`${CARD} flex flex-wrap items-center gap-4 p-5`}>
                  <span className={`h-3 w-3 shrink-0 rounded-full ${s.color}`} title={s.label} data-testid={`apikey-status-${k.id}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-white">{PROVIDER_LABEL[k.provider] || k.provider}</p>
                    <p className="font-mono text-xs text-[#8c8385]">•••• {k.key_last4}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] font-semibold text-[#a3999b]">{s.label}</p>
                    <p className="text-[11px] text-[#8c8385]">tested {relTime(k.last_tested_at)}</p>
                  </div>
                  <div className="min-w-[120px] text-right"><BalanceCell balance={k.balance_info} /></div>
                  <div className="flex items-center gap-2">
                    <button data-testid={`apikey-test-${k.id}`} onClick={() => testSaved(k.id)} disabled={!!busy}
                      className="flex items-center gap-1.5 rounded-xl border border-[rgba(212,175,55,0.25)] px-3 py-2 text-xs font-bold text-[#d4af37] transition-colors hover:bg-[#d4af37]/10 disabled:opacity-50">
                      {busy === "test" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Test
                    </button>
                    <button data-testid={`apikey-delete-${k.id}`} onClick={() => remove(k.id)} disabled={!!busy}
                      className="grid h-9 w-9 place-items-center rounded-xl bg-[#c41230]/15 text-[#c41230] transition-colors hover:bg-[#c41230]/25 disabled:opacity-50">
                      {busy === "delete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
