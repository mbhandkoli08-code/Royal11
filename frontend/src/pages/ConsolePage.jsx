import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  LayoutGrid, Users, UserCheck, UsersRound, Receipt, KeyRound,
  Banknote, Landmark, Scale, Zap, Crown, LogOut, ExternalLink, Search, Menu, X,
  Globe2, ClipboardList, Trophy, Palette, ShieldAlert,
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
import { DepositsPanel } from "@/console/DepositsPanel";
import { BankAccountPanel } from "@/console/BankAccountPanel";
import { SettlementsPanel } from "@/console/SettlementsPanel";
import { RechargePanel } from "@/console/RechargePanel";
import { RechargeQueuePanel } from "@/console/RechargeQueuePanel";
import { ZonalManagersPanel } from "@/console/ZonalManagersPanel";
import { MyManagersPanel } from "@/console/MyManagersPanel";
import { AdminRequestsPanel } from "@/console/AdminRequestsPanel";
import { FantasyPanel } from "@/console/FantasyPanel";
import { BrandingPanel } from "@/console/BrandingPanel";
import { SecurityPanel } from "@/console/SecurityPanel";
import { CasinoCommissionPanel } from "@/console/CasinoCommissionPanel";
import { ThemeSwitcher } from "@/console/ThemeSwitcher";
import "@/console/theme.css";

const NAV = {
  SUPER_ADMIN: [
    { section: "Core", items: [
      { id: "overview", label: "Overview", icon: LayoutGrid },
      { id: "zonal-managers", label: "Zonal Managers", icon: Globe2 },
      { id: "managers", label: "Managers", icon: UserCheck },
      { id: "admins", label: "Admins", icon: Users },
      { id: "admin-requests", label: "Admin Requests", icon: ClipboardList },
    ] },
    { section: "Coins & Financials", items: [
      { id: "deposits", label: "Deposits", icon: Banknote },
      { id: "settlements", label: "Settlements", icon: Scale },
      { id: "recharge-queue", label: "Recharge Requests", icon: Zap },
      { id: "transactions", label: "Transactions", icon: Receipt },
    ] },
    { section: "Games", items: [
      { id: "fantasy", label: "Fantasy Contests", icon: Trophy },
      { id: "casino-commission", label: "Casino Commission", icon: Landmark },
    ] },
    { section: "System", items: [
      { id: "apikeys", label: "API Keys", icon: KeyRound },
      { id: "security", label: "Login Security", icon: ShieldAlert },
    ] },
  ],
  ZONAL_MANAGER: [
    { section: "Core", items: [
      { id: "my-managers", label: "My Managers", icon: UserCheck },
      { id: "admin-requests", label: "Admin Requests", icon: ClipboardList },
    ] },
    { section: "Coins & Financials", items: [
      { id: "my-transactions", label: "Transactions", icon: Receipt },
    ] },
  ],
  MANAGER: [
    { section: "Core", items: [
      { id: "my-admins", label: "My Admins", icon: Users },
      { id: "admin-requests", label: "Admin Requests", icon: ClipboardList },
    ] },
    { section: "Coins & Financials", items: [
      { id: "deposits", label: "Deposits", icon: Banknote },
      { id: "bank-account", label: "Bank Account", icon: Landmark },
      { id: "my-transactions", label: "Transactions", icon: Receipt },
    ] },
  ],
  ADMIN: [
    { section: "Core", items: [{ id: "my-players", label: "My Players", icon: UsersRound }] },
    { section: "Coins & Financials", items: [
      { id: "deposits", label: "Deposits", icon: Banknote },
      { id: "recharge", label: "Recharge Quota", icon: Zap },
      { id: "bank-account", label: "Bank Account", icon: Landmark },
      { id: "my-transactions", label: "Transactions", icon: Receipt },
    ] },
    { section: "Games", items: [
      { id: "fantasy", label: "Fantasy Contests", icon: Trophy },
    ] },
    { section: "System", items: [
      { id: "branding", label: "Login Branding", icon: Palette },
    ] },
  ],
};

const ROLE_BADGE = { SUPER_ADMIN: "SUPER", ZONAL_MANAGER: "ZONAL", MANAGER: "MANAGER", ADMIN: "ADMIN" };

const Brand = () => (
  <div className="flex items-center gap-2.5" data-testid="console-brand">
    <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-orange-500 to-rose-600 text-white shadow-sm">
      <Crown className="h-5 w-5" />
    </span>
    <div className="leading-none">
      <p className="font-display text-lg font-bold tracking-tight text-slate-900">ROYAL 11</p>
      <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Admin Platform</p>
    </div>
  </div>
);

const NavList = ({ groups, active, onSelect }) => (
  <nav className="flex flex-col gap-6">
    {groups.map((g) => (
      <div key={g.section}>
        <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{g.section}</p>
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
                  on ? "bg-sky-50 text-sky-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                {on && <motion.span layoutId="nav-active" className="absolute right-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-l-full bg-sky-500" />}
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors ${on ? "bg-sky-500 text-white" : "bg-slate-100 text-slate-500"}`}>
                  <Icon className="h-[16px] w-[16px]" />
                </span>
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
  const [theme, setTheme] = useState(user?.console_theme || "default");

  const activeTitle = useMemo(() => {
    for (const g of groups) for (const it of g.items) if (it.id === active) return it.label;
    return "Console";
  }, [groups, active]);

  const select = (id) => { setActive(id); setQuery(""); setMobileNav(false); };

  const renderPanel = () => {
    switch (active) {
      case "overview": return <OverviewPanel onNavigate={select} />;
      case "zonal-managers": return <ZonalManagersPanel query={query} />;
      case "managers": return <ManagersPanel query={query} />;
      case "admins": return <AdminsPanel query={query} />;
      case "admin-requests": return <AdminRequestsPanel query={query} />;
      case "fantasy": return <FantasyPanel />;
      case "casino-commission": return <CasinoCommissionPanel />;
      case "branding": return <BrandingPanel />;
      case "security": return <SecurityPanel />;
      case "my-managers": return <MyManagersPanel query={query} />;
      case "transactions": return <TransactionsPanel query={query} />;
      case "apikeys": return <ApiKeysPanel />;
      case "deposits": return <DepositsPanel query={query} />;
      case "settlements": return <SettlementsPanel query={query} />;
      case "recharge-queue": return <RechargeQueuePanel query={query} />;
      case "recharge": return <RechargePanel />;
      case "bank-account": return <BankAccountPanel />;
      case "my-admins": return <MyAdminsPanel query={query} />;
      case "my-players": return <MyPlayersPanel query={query} />;
      case "my-transactions": return <MyTransactionsPanel />;
      default: return null;
    }
  };

  return (
    <div className={`console-root min-h-screen bg-slate-50 font-console text-slate-900`} data-theme={theme} data-testid="console-page">
      {/* Sidebar (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-slate-200 bg-white px-4 py-6 lg:flex">
        <Brand />
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-sky-50 px-3 py-1.5">
          <span className="text-[11px] font-bold tracking-wide text-sky-700">{ROLE_BADGE[user?.role]}</span>
        </div>
        <div className="mt-8 flex-1 overflow-y-auto no-scrollbar">
          <NavList groups={groups} active={active} onSelect={select} />
        </div>
        <button
          data-testid="console-back-app"
          onClick={() => navigate("/")}
          className="mt-4 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
        >
          <ExternalLink className="h-[18px] w-[18px]" /> Back to app
        </button>
      </aside>

      {/* Mobile nav drawer */}
      {mobileNav && (
        <div className="fixed inset-0 z-50 lg:hidden" data-testid="mobile-nav">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileNav(false)} />
          <div className="absolute inset-y-0 left-0 w-64 border-r border-slate-200 bg-white px-4 py-6">
            <div className="flex items-center justify-between">
              <Brand />
              <button onClick={() => setMobileNav(false)} className="text-slate-400"><X className="h-5 w-5" /></button>
            </div>
            <div className="mt-8"><NavList groups={groups} active={active} onSelect={select} /></div>
          </div>
        </div>
      )}

      {/* Main */}
      <div className="lg:pl-60">
        {/* Topbar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3.5 backdrop-blur-xl sm:px-8">
          <button data-testid="mobile-nav-toggle" onClick={() => setMobileNav(true)} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-500 lg:hidden">
            <Menu className="h-5 w-5" />
          </button>
          <div className="relative flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              data-testid="console-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${activeTitle.toLowerCase()}…`}
              className="w-full rounded-full border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-100"
            />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <a
              href="https://stripe.com/global"
              target="_blank"
              rel="noreferrer"
              data-testid="topbar-help-pill"
              className="hidden rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 sm:inline-flex"
            >
              Help
            </a>
            <div className="hidden text-right sm:block">
              <p className="text-sm font-bold leading-tight text-slate-900" data-testid="console-user-name">{user?.display_name}</p>
              <p className="text-[11px] text-slate-400">{user?.email}</p>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-sky-100 font-display text-sm font-bold text-sky-700">
              {(user?.display_name || "?").slice(0, 1).toUpperCase()}
            </span>
            <ThemeSwitcher theme={theme} onChange={setTheme} />
            <button
              data-testid="console-logout"
              onClick={() => { logout(); toast("Logged out"); }}
              className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </header>

        <main className="px-4 py-8 sm:px-8 lg:px-10" data-testid="console-main">
          <div className="mx-auto max-w-6xl">
            {user?.status === "SUSPENDED" && (
              <div data-testid="suspended-banner" className="mb-6 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-rose-500 text-white text-xs font-bold">!</span>
                <div>
                  <p className="text-sm font-bold text-rose-700">Account suspended</p>
                  <p className="mt-0.5 text-xs text-rose-600">
                    {user?.suspension_reason === "COINS_EXHAUSTED"
                      ? "You've used all your allocated coins. A Manager or Super Admin must allocate more before you can act again."
                      : user?.suspension_reason === "SETTLEMENT_OVERDUE"
                      ? "A pending settlement is overdue. Access is read-only until your Super Admin marks it settled."
                      : "Your account is read-only. Please contact your Super Admin."}
                  </p>
                </div>
              </div>
            )}
            {renderPanel()}
          </div>
        </main>
      </div>
    </div>
  );
}
