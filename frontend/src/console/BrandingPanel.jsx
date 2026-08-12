import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Save, Link2, Copy, Check, ImageUp, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useConsoleApi } from "./api";
import { CARD, PanelHeader, PrimaryButton, GhostButton, Field, Spinner } from "./primitives";

const BACKEND = process.env.REACT_APP_BACKEND_URL;

// Reusable editor. `basePath` = "/admin/branding" (self) or
// "/admin/admins/{id}/branding" (Super Admin editing an Admin).
export const BrandingForm = ({ basePath }) => {
  const api = useConsoleApi();
  const fileRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [cacheBust, setCacheBust] = useState(Date.now());
  const [data, setData] = useState({ brand_name: "", brand_slug: "", has_logo: false });
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(basePath);
      setData(data);
      setName(data.brand_name || "");
      setSlug(data.brand_slug || "");
    } catch {
      toast.error("Couldn't load branding");
    } finally {
      setLoading(false);
    }
  }, [api, basePath]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (busy) return;
    if (!name.trim()) return toast.error("Enter a brand name");
    setBusy(true);
    try {
      const { data } = await api.put(basePath, { brand_name: name.trim(), slug: slug.trim() || undefined });
      setData(data);
      setSlug(data.brand_slug || "");
      toast.success("Branding saved");
    } catch (e) {
      toast.error("Couldn't save", { description: e.response?.data?.detail || "" });
    } finally { setBusy(false); }
  };

  const onPickLogo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Logo must be an image");
    if (file.size > 4 * 1024 * 1024) return toast.error("Logo must be under 4 MB");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("logo", file);
      const { data } = await api.post(`${basePath}/logo`, fd);
      setData(data);
      setCacheBust(Date.now());
      toast.success("Logo updated");
    } catch (e) {
      toast.error("Upload failed", { description: e.response?.data?.detail || "" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const loginUrl = data.brand_slug ? `${window.location.origin}/login/${data.brand_slug}` : "";
  const logoSrc = data.brand_slug && data.has_logo
    ? `${BACKEND}/api/public/branding/${data.brand_slug}/logo?t=${cacheBust}` : "";

  const copyUrl = async () => {
    try { await navigator.clipboard.writeText(loginUrl); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { toast.error("Couldn't copy"); }
  };

  if (loading) return <Spinner label="Loading branding…" />;

  return (
    <div className="space-y-6" data-testid="branding-form">
      <div className={`${CARD} p-6`}>
        <div className="grid gap-6 sm:grid-cols-[auto,1fr] sm:items-start">
          {/* Logo */}
          <div className="flex flex-col items-center gap-3">
            <div className="grid h-24 w-24 place-items-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
              {logoSrc ? (
                <img src={logoSrc} alt="Brand logo" className="h-full w-full object-cover" data-testid="branding-logo-preview" />
              ) : (
                <span className="px-2 text-center text-[11px] font-semibold text-slate-400">No logo yet</span>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickLogo} data-testid="branding-logo-input" />
            <GhostButton data-testid="branding-logo-btn" onClick={() => fileRef.current?.click()} disabled={uploading} className="!px-3 !py-2 text-xs">
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageUp className="h-3.5 w-3.5" />} Upload logo
            </GhostButton>
          </div>

          {/* Fields */}
          <div className="space-y-4">
            <Field label="Brand / business name" data-testid="branding-name" value={name}
              onChange={(e) => setName(e.target.value)} placeholder="e.g. Raja Gaming Club"
              hint="Shown as “Welcome to <name>” on your login page." />
            <Field label="Custom link (optional)" data-testid="branding-slug" value={slug}
              onChange={(e) => setSlug(e.target.value)} placeholder="auto-generated from your name"
              hint="Letters, numbers and hyphens only. Leave blank to auto-generate." />
            <PrimaryButton data-testid="branding-save" onClick={save} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Branding
            </PrimaryButton>
          </div>
        </div>
      </div>

      {loginUrl && (
        <div className={`${CARD} p-5`} data-testid="branding-link-card">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <Link2 className="h-4 w-4 text-sky-600" /> Your branded login link
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="flex-1 truncate rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-700" data-testid="branding-url">{loginUrl}</code>
            <GhostButton data-testid="branding-copy" onClick={copyUrl} className="!px-3 !py-2 text-xs">
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
            </GhostButton>
            <a href={loginUrl} target="_blank" rel="noreferrer" data-testid="branding-open"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-sky-200 bg-white px-3 py-2 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-50">
              <ExternalLink className="h-3.5 w-3.5" /> Open
            </a>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">Share this link with your players — they'll see your name and logo on the standard ROYAL11 login. Login itself works exactly the same.</p>
        </div>
      )}
    </div>
  );
};

// Admin self-service panel.
export const BrandingPanel = () => (
  <div data-testid="branding-panel">
    <PanelHeader title="Login Branding" subtitle="Personalise the login page your players see with your own name and logo." />
    <BrandingForm basePath="/admin/branding" />
  </div>
);
