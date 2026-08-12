import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { X, Loader2, Search, ChevronLeft, ChevronRight, Inbox } from "lucide-react";

// Shared light-theme primitives for the ROYAL 11 Admin Console (banking style).
// Palette: page slate-50 · cards white · accent sky-500 · text slate-900/500
// status green/amber/red only.

// Smoothly count-up/down to a numeric value whenever it changes (easeOutCubic).
// Purely visual; triggers on the existing data-refresh cycle (no new polling).
export const AnimatedNumber = ({ value = 0, format = (n) => n, duration = 900, testid }) => {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef();

  useEffect(() => {
    const from = fromRef.current;
    const to = Number(value) || 0;
    if (from === to) { setDisplay(to); return undefined; }
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
        setDisplay(to);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  return <span data-testid={testid}>{format(Math.round(display))}</span>;
};

export const CARD =
  "rounded-2xl border border-slate-200/60 bg-white shadow-[0_2px_10px_-3px_rgba(6,81,237,0.08)]";

export const thCls =
  "px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap";
export const tdCls = "px-4 py-3.5 text-slate-700 whitespace-nowrap tabular-nums";

export const PanelHeader = ({ title, subtitle, actions }) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div>
      <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
    </div>
    {actions && <div className="flex items-center gap-2">{actions}</div>}
  </div>
);

export const StatCard = ({ icon: Icon, label, value, sub, accent = "sky", testid }) => (
  <div data-testid={testid} className={`${CARD} p-5 transition-transform duration-200 hover:-translate-y-[2px]`}>
    <div className="flex items-center justify-between">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      <span className={`grid h-9 w-9 place-items-center rounded-xl ${accent === "cherry" ? "bg-rose-50 text-rose-600" : "bg-sky-50 text-sky-600"}`}>
        <Icon className="h-4 w-4" />
      </span>
    </div>
    <p className="mt-3 font-display text-3xl font-bold tracking-tight text-slate-900 tabular-nums">{value}</p>
    {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
  </div>
);

export const StatusBadge = ({ status }) => {
  const s = (status || "").toUpperCase();
  const map = {
    ACTIVE: "bg-emerald-100 text-emerald-700 border-emerald-200",
    COMPLETED: "bg-emerald-100 text-emerald-700 border-emerald-200",
    SETTLED: "bg-emerald-100 text-emerald-700 border-emerald-200",
    DISABLED: "bg-slate-100 text-slate-600 border-slate-200",
    PENDING: "bg-amber-100 text-amber-700 border-amber-200",
    FAILED: "bg-rose-100 text-rose-700 border-rose-200",
    REJECTED: "bg-rose-100 text-rose-700 border-rose-200",
    SUSPENDED: "bg-rose-100 text-rose-700 border-rose-200",
  };
  return (
    <span className={`inline-flex rounded-md border px-2.5 py-1 text-[11px] font-semibold ${map[s] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
      {s || "—"}
    </span>
  );
};

export const UsageBar = ({ pct = 0 }) => (
  <div className="flex items-center gap-2">
    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${pct >= 90 ? "bg-rose-500" : "bg-sky-500"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
    <span className="text-xs font-semibold text-slate-500 tabular-nums">{pct}%</span>
  </div>
);

export const UsageBadge = ({ level }) => {
  if (!level) return null;
  const map = {
    warn: { cls: "bg-amber-100 text-amber-700", label: "80%+" },
    danger: { cls: "bg-orange-100 text-orange-700", label: "90%+" },
    critical: { cls: "bg-rose-100 text-rose-700", label: "Exhausted" },
  };
  const m = map[level];
  return <span className={`ml-2 inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold ${m.cls}`}>{m.label}</span>;
};

export const PrimaryButton = ({ children, className = "", ...p }) => (
  <button {...p} className={`inline-flex items-center justify-center gap-2 rounded-full bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sky-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>
    {children}
  </button>
);

export const GhostButton = ({ children, className = "", ...p }) => (
  <button {...p} className={`inline-flex items-center justify-center gap-2 rounded-full border border-sky-200 bg-white px-4 py-2.5 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>
    {children}
  </button>
);

export const SearchBar = ({ value, onChange, placeholder = "Search…", testid = "console-search" }) => (
  <div className="relative">
    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    <input
      data-testid={testid}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-full border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
    />
  </div>
);

export const Field = ({ label, hint, ...p }) => (
  <label className="block">
    <span className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</span>
    <input {...p} className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
    {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
  </label>
);

export const Modal = ({ open, onClose, title, children, testid }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" data-testid={testid}>
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="font-display text-lg font-bold text-slate-900">{title}</h3>
          <button data-testid="modal-close-btn" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </motion.div>
    </div>
  );
};

export const Spinner = ({ label }) => (
  <div className="flex items-center justify-center gap-3 py-16 text-sm text-slate-500">
    <Loader2 className="h-5 w-5 animate-spin text-sky-500" />
    {label || "Loading…"}
  </div>
);

export const EmptyState = ({ title, subtitle, testid }) => (
  <div data-testid={testid} className={`${CARD} flex flex-col items-center justify-center px-6 py-16 text-center`}>
    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-sky-50 text-sky-600">
      <Inbox className="h-6 w-6" />
    </span>
    <p className="mt-4 text-sm font-semibold text-slate-900">{title}</p>
    {subtitle && <p className="mt-1 max-w-sm text-xs text-slate-400">{subtitle}</p>}
  </div>
);

export const ComingSoonCard = ({ title, note, testid }) => (
  <div data-testid={testid} className={`${CARD} flex h-full min-h-[140px] flex-col justify-between p-5`}>
    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</span>
    <div>
      <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">Coming soon</span>
      <p className="mt-2 text-xs text-slate-400">{note}</p>
    </div>
  </div>
);

export const Pagination = ({ skip, limit, total, onPage }) => {
  const from = total === 0 ? 0 : skip + 1;
  const to = Math.min(skip + limit, total);
  const canPrev = skip > 0;
  const canNext = skip + limit < total;
  return (
    <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
      <span data-testid="pagination-info">{from}–{to} of {total}</span>
      <div className="flex items-center gap-2">
        <button data-testid="pagination-prev" disabled={!canPrev} onClick={() => onPage(Math.max(0, skip - limit))}
          className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-30">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button data-testid="pagination-next" disabled={!canNext} onClick={() => onPage(skip + limit)}
          className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-30">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
