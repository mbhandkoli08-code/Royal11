import { motion } from "framer-motion";
import { X, Loader2, Search, ChevronLeft, ChevronRight, Inbox } from "lucide-react";

// Shared dark-theme primitives for the ROYAL 11 Admin Console.
// Palette: page #0d0d0d · card #1b1012 · gold #d4af37 · cherry #c41230
// muted text #8c8385 / #a3999b · gold border rgba(212,175,55,0.15)

export const CARD =
  "rounded-2xl border border-[rgba(212,175,55,0.15)] bg-[#1b1012]";

export const thCls =
  "px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-[#8c8385] whitespace-nowrap";
export const tdCls = "px-4 py-3.5 text-slate-200 whitespace-nowrap";

export const PanelHeader = ({ title, subtitle, actions }) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div>
      <h1 className="font-display text-2xl font-extrabold tracking-tight text-white">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-[#8c8385]">{subtitle}</p>}
    </div>
    {actions && <div className="flex items-center gap-2">{actions}</div>}
  </div>
);

export const StatCard = ({ icon: Icon, label, value, sub, accent = "gold", testid }) => (
  <div data-testid={testid} className={`${CARD} p-5`}>
    <div className="flex items-center justify-between">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8c8385]">{label}</span>
      <span className={`grid h-9 w-9 place-items-center rounded-xl ${accent === "cherry" ? "bg-[#c41230]/15 text-[#c41230]" : "bg-[#d4af37]/10 text-[#d4af37]"}`}>
        <Icon className="h-4 w-4" />
      </span>
    </div>
    <p className={`mt-3 font-display text-3xl font-extrabold tracking-tight ${accent === "cherry" ? "text-white" : "text-[#d4af37]"}`}>{value}</p>
    {sub && <p className="mt-1 text-xs text-[#8c8385]">{sub}</p>}
  </div>
);

export const StatusBadge = ({ status }) => {
  const s = (status || "").toUpperCase();
  const map = {
    ACTIVE: "bg-emerald-500/15 text-emerald-400",
    COMPLETED: "bg-emerald-500/15 text-emerald-400",
    DISABLED: "bg-slate-500/15 text-slate-400",
    PENDING: "bg-amber-500/15 text-amber-400",
    FAILED: "bg-red-500/15 text-red-400",
  };
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${map[s] || "bg-white/10 text-slate-300"}`}>
      {s || "—"}
    </span>
  );
};

export const UsageBar = ({ pct = 0 }) => (
  <div className="flex items-center gap-2">
    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
      <div className={`h-full rounded-full ${pct >= 90 ? "bg-[#c41230]" : "bg-[#d4af37]"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
    <span className="text-xs font-semibold text-[#a3999b]">{pct}%</span>
  </div>
);

export const PrimaryButton = ({ children, className = "", ...p }) => (
  <button {...p} className={`inline-flex items-center justify-center gap-2 rounded-xl bg-[#c41230] px-4 py-2.5 text-sm font-bold text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>
    {children}
  </button>
);

export const GhostButton = ({ children, className = "", ...p }) => (
  <button {...p} className={`inline-flex items-center justify-center gap-2 rounded-xl border border-[rgba(212,175,55,0.25)] bg-transparent px-4 py-2.5 text-sm font-bold text-[#d4af37] transition-colors hover:bg-[#d4af37]/10 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>
    {children}
  </button>
);

export const SearchBar = ({ value, onChange, placeholder = "Search…", testid = "console-search" }) => (
  <div className="relative">
    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8c8385]" />
    <input
      data-testid={testid}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-xl border border-white/10 bg-[#0d0d0d] py-2.5 pl-10 pr-4 text-sm text-white outline-none transition-colors placeholder:text-[#8c8385] focus:border-[#d4af37]/50"
    />
  </div>
);

export const Field = ({ label, hint, ...p }) => (
  <label className="block">
    <span className="mb-1.5 block text-xs font-semibold text-[#a3999b]">{label}</span>
    <input {...p} className="w-full rounded-xl border border-white/10 bg-[#0d0d0d] px-3.5 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-[#8c8385] focus:border-[#d4af37]/50" />
    {hint && <span className="mt-1 block text-[11px] text-[#8c8385]">{hint}</span>}
  </label>
);

export const Modal = ({ open, onClose, title, children, testid }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" data-testid={testid}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative w-full max-w-md rounded-2xl border border-[rgba(212,175,55,0.2)] bg-[#1b1012] p-6 shadow-2xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="font-display text-lg font-extrabold text-white">{title}</h3>
          <button data-testid="modal-close-btn" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-[#8c8385] transition-colors hover:bg-white/5 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </motion.div>
    </div>
  );
};

export const Spinner = ({ label }) => (
  <div className="flex items-center justify-center gap-3 py-16 text-sm text-[#8c8385]">
    <Loader2 className="h-5 w-5 animate-spin text-[#d4af37]" />
    {label || "Loading…"}
  </div>
);

export const EmptyState = ({ title, subtitle, testid }) => (
  <div data-testid={testid} className={`${CARD} flex flex-col items-center justify-center px-6 py-16 text-center`}>
    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#d4af37]/10 text-[#d4af37]">
      <Inbox className="h-6 w-6" />
    </span>
    <p className="mt-4 text-sm font-bold text-white">{title}</p>
    {subtitle && <p className="mt-1 max-w-sm text-xs text-[#8c8385]">{subtitle}</p>}
  </div>
);

export const ComingSoonCard = ({ title, note, testid }) => (
  <div data-testid={testid} className={`${CARD} flex h-full min-h-[140px] flex-col justify-between p-5`}>
    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8c8385]">{title}</span>
    <div>
      <span className="inline-flex rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-bold text-[#a3999b]">Coming soon</span>
      <p className="mt-2 text-xs text-[#8c8385]">{note}</p>
    </div>
  </div>
);

export const Pagination = ({ skip, limit, total, onPage }) => {
  const from = total === 0 ? 0 : skip + 1;
  const to = Math.min(skip + limit, total);
  const canPrev = skip > 0;
  const canNext = skip + limit < total;
  return (
    <div className="mt-4 flex items-center justify-between text-xs text-[#8c8385]">
      <span data-testid="pagination-info">{from}–{to} of {total}</span>
      <div className="flex items-center gap-2">
        <button data-testid="pagination-prev" disabled={!canPrev} onClick={() => onPage(Math.max(0, skip - limit))}
          className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-slate-300 transition-colors hover:bg-white/5 disabled:opacity-30">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button data-testid="pagination-next" disabled={!canNext} onClick={() => onPage(skip + limit)}
          className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-slate-300 transition-colors hover:bg-white/5 disabled:opacity-30">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
