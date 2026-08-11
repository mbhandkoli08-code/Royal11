import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  LayoutGrid, Users, UserCheck, UsersRound, Receipt, KeyRound,
  Crown, LogOut, ExternalLink, Search, Menu, X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { ApiKeysPanel } from "@/components/ApiKeysPanel";
import { OverviewPanel } from "@/console/OverviewPanel";
import { ManagersPanel } from "@/console/ManagersPanel";
import { AdminsPanel } from "@/console/AdminsPanel";
import { TransactionsPanel } from "@/console/TransactionsPanel";
import { MyAdminsPanel } from "@/console/MyAdminsPanel";
import { MyPlayersPanel } from "@/console/MyPlayersPanel";
import { MyTransactionsPanel } from "@/console/MyTransactionsPanel";

const NAV = {
  SUPER_ADMIN: [
    { section: "Core", items: [
      { id: "overview", label: "Overview", icon: LayoutGrid },
      { id: "managers", label: "Managers", icon: UserCheck },
      { id: "admins", label: "Admins", icon: Users },
    ] },
    { section: "Coins & Financials", items: [
      { id: "transactions", label: "Transactions", icon: Receipt },
    ] },
    { section: "System", items: [
      { id: "apikeys", label: "API Keys", icon: KeyRound },
    ] },
  ],
  MANAGER: [
    { section: "Core", items: [{ id: "my-admins", label: "My Admins", icon: Users }] },
    { section: "Coins & Financials", items: [{ id: "my-transactions", label: "Transactions", icon: Receipt }] },
  ],
  ADMIN: [
    { section: "Core", items: [{ id: "my-players", label: "My Players", icon: UsersRound }] },
    { section: "Coins & Financials", items: [{ id: "my-transactions", label: "Transactions", icon: Receipt }] },
  ],
};

const ROLE_BADGE = { SUPER_ADMIN: "SUPER", MANAGER: "MANAGER", ADMIN: "ADMIN" };

const Brand = () => (
  <div className="flex items-center gap-2.5" data-testid="console-brand">
    <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#c41230] text-white">
      <Crown className="h-5 w-5" />
    </span>
    <div className="leading-none">
      <p className="font-display text-lg font-black tracking-tight text-white">ROYAL 11</p>
      <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8c8385]">Admin Platform</p>
    </div>
  </div>
);

const NavList = ({ groups, active, onSelect }) => (
  <nav className="flex flex-col gap-6">
    {groups.map((g) => (
      <div key={g.section}>
        <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-[#8c8385]">{g.section}</p>
        <div className="flex flex-col gap-1">
          {g.items.map((it) => {
            const Icon = it.icon;
            const on = active === it.id;
            return (
              <button
                key={it.id}
                data-testid={`nav-${it.id}`}
                onClick={() => onSelect(it.id)}
                className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                  on ? "bg-[#c41230]/15 text-white" : "text-[#a3999b] hover:bg-white/5 hover:text-white"
                }`}
              >
                {on && <motion.span layoutId="nav-active" className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-[#c41230]" />}
                <Icon className={`h-[18px] w-[18px] ${on ? "text-[#d4af37]" : ""}`} />
                {it.label}
              </button>
            );
          })}
        </div>
      </div>
    ))}
  </nav>
);

export default function ConsolePage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const groups = NAV[user?.role] || [];
  const [active, setActive] = useState(groups[0]?.items[0]?.id);
  const [query, setQuery] = useState("");
  const [mobileNav, setMobileNav] = useState(false);

  const activeTitle = useMemo(() => {
    for (const g of groups) for (const it of g.items) if (it.id === active) return it.label;
    return "Console";
  }, [groups, active]);

  const select = (id) => { setActive(id); setQuery(""); setMobileNav(false); };

  const renderPanel = () => {
    switch (active) {
      case "overview": return <OverviewPanel />;
      case "managers": return <ManagersPanel query={query} />;
      case "admins": return <AdminsPanel query={query} />;
      case "transactions": return <TransactionsPanel query={query} />;
      case "apikeys": return <ApiKeysPanel />;
      case "my-admins": return <MyAdminsPanel query={query} />;
      case "my-players": return <MyPlayersPanel query={query} />;
      case "my-transactions": return <MyTransactionsPanel />;
      default: return null;
    }
  };

  return (
    <div className="min-h-screen bg-[#0d0d0d] font-display text-white" data-testid="console-page">
      {/* Sidebar (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-[rgba(212,175,55,0.12)] bg-[#090607] px-4 py-6 lg:flex">
        <Brand />
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-[#d4af37]/10 px-3 py-1.5">
          <span className="text-[11px] font-bold tracking-wide text-[#d4af37]">{ROLE_BADGE[user?.role]}</span>
        </div>
        <div className="mt-8 flex-1 overflow-y-auto no-scrollbar">
          <NavList groups={groups} active={active} onSelect={select} />
        </div>
        <button
          data-testid="console-back-app"
          onClick={() => navigate("/")}
          className="mt-4 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-[#a3999b] transition-colors hover:bg-white/5 hover:text-white"
        >
          <ExternalLink className="h-[18px] w-[18px]" /> Back to app
        </button>
      </aside>

      {/* Mobile nav drawer */}
      {mobileNav && (
        <div className="fixed inset-0 z-50 lg:hidden" data-testid="mobile-nav">
          <div className="absolute inset-0 bg-black/70" onClick={() => setMobileNav(false)} />
          <div className="absolute inset-y-0 left-0 w-64 border-r border-[rgba(212,175,55,0.12)] bg-[#090607] px-4 py-6">
            <div className="flex items-center justify-between">
              <Brand />
              <button onClick={() => setMobileNav(false)} className="text-[#8c8385]"><X className="h-5 w-5" /></button>
            </div>
            <div className="mt-8"><NavList groups={groups} active={active} onSelect={select} /></div>
          </div>
        </div>
      )}

      {/* Main */}
      <div className="lg:pl-60">
        {/* Topbar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-[rgba(212,175,55,0.12)] bg-[#0d0d0d]/90 px-4 py-3.5 backdrop-blur-xl sm:px-8">
          <button data-testid="mobile-nav-toggle" onClick={() => setMobileNav(true)} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-[#a3999b] lg:hidden">
            <Menu className="h-5 w-5" />
          </button>
          <div className="relative flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8c8385]" />
            <input
              data-testid="console-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${activeTitle.toLowerCase()}…`}
              className="w-full rounded-xl border border-white/10 bg-[#1b1012] py-2.5 pl-10 pr-4 text-sm text-white outline-none transition-colors placeholder:text-[#8c8385] focus:border-[#d4af37]/50"
            />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-bold leading-tight text-white" data-testid="console-user-name">{user?.display_name}</p>
              <p className="text-[11px] text-[#8c8385]">{user?.email}</p>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#d4af37]/15 font-display text-sm font-black text-[#d4af37]">
              {(user?.display_name || "?").slice(0, 1).toUpperCase()}
            </span>
            <button
              data-testid="console-logout"
              onClick={() => { logout(); toast("Logged out"); }}
              className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-[#a3999b] transition-colors hover:bg-white/5 hover:text-white"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </header>

        <main className="px-4 py-8 sm:px-8 lg:px-10" data-testid="console-main">
          <div className="mx-auto max-w-6xl">{renderPanel()}</div>
        </main>
      </div>
    </div>
  );
}
