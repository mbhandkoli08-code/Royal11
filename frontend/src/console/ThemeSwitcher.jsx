import { useEffect, useRef, useState } from "react";
import { Palette, Check } from "lucide-react";
import axios from "axios";
import { useAuth } from "@/context/AuthContext";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const THEMES = [
  { id: "default", label: "Cherry & Sky", swatch: ["#f97316", "#0ea5e9"] },
  { id: "dark", label: "Dark Mode", swatch: ["#0b1220", "#7dd3fc"] },
  { id: "sky", label: "Sky Blue & White", swatch: ["#2563eb", "#dbeafe"] },
  { id: "navy", label: "Navy & Gold", swatch: ["#0f1c3a", "#d4af37"] },
];

// Top-bar per-user theme picker. Persists the choice to the account.
export const ThemeSwitcher = ({ theme, onChange }) => {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = async (id) => {
    onChange(id);
    setOpen(false);
    try {
      await axios.put(`${API}/auth/console-theme`, { theme: id }, { headers: { Authorization: `Bearer ${token}` } });
    } catch { /* best-effort; local applies immediately */ }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        data-testid="theme-switcher-btn"
        onClick={() => setOpen((o) => !o)}
        className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
        aria-label="Change theme"
      >
        <Palette className="h-5 w-5" />
      </button>
      {open && (
        <div data-testid="theme-menu" className="absolute right-0 top-12 z-50 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl">
          <p className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Console theme</p>
          {THEMES.map((t) => (
            <button
              key={t.id}
              data-testid={`theme-option-${t.id}`}
              onClick={() => pick(t.id)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              <span className="flex h-6 w-10 overflow-hidden rounded-md ring-1 ring-slate-200">
                <span className="h-full w-1/2" style={{ background: t.swatch[0] }} />
                <span className="h-full w-1/2" style={{ background: t.swatch[1] }} />
              </span>
              <span className="flex-1 text-left">{t.label}</span>
              {theme === t.id && <Check className="h-4 w-4 text-sky-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
