import { NavLink } from "react-router-dom";
import logoSm from "@/assets/royal11-logo-sm.png";
import { NAV_ITEMS as ITEMS } from "@/lib/navItems";

// Persistent desktop/tablet navigation. Collapses to a 76px icon-rail at `md`
// (iPad portrait / Z Fold unfolded) and expands to a 256px labelled sidebar at
// `lg`. Hidden below `md`, where BottomNav takes over.
export const SideNav = () => {
  return (
    <aside
      data-testid="side-nav"
      className="fixed inset-y-0 left-0 z-40 hidden w-[76px] flex-col border-r border-slate-100 bg-white/85 backdrop-blur-xl md:flex lg:w-64"
    >
      {/* Brand */}
      <div className="flex h-[72px] items-center gap-3 px-4 lg:px-6" data-testid="side-nav-brand">
        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-2xl ring-1 ring-amber-300/40 shadow-[0_6px_18px_rgba(200,16,46,0.35)]">
          <img src={logoSm} alt="ROYAL11" className="h-full w-full object-cover" draggable={false} />
        </div>
        <div className="hidden leading-none lg:block">
          <div className="font-display text-lg font-extrabold tracking-tight">
            <span className="bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">ROYAL</span>
            <span className="bg-gradient-to-r from-flame to-royal bg-clip-text text-transparent">11</span>
          </div>
          <div className="mt-0.5 text-[8px] font-bold uppercase tracking-[0.28em] text-royal/70">Play · Win · Repeat</div>
        </div>
      </div>

      {/* Nav items */}
      <nav className="mt-2 flex flex-1 flex-col gap-1 px-3">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.id}
              to={item.to}
              end={item.to === "/"}
              data-testid={`side-nav-${item.id}`}
              title={item.label}
              className={({ isActive }) =>
                `group flex min-h-[48px] items-center gap-3 rounded-2xl px-3 text-sm font-semibold transition-colors ${
                  isActive
                    ? "bg-royal-light text-royal"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                } justify-center lg:justify-start`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className={`h-[22px] w-[22px] shrink-0 transition-transform group-hover:scale-110 ${
                      isActive ? "text-royal" : ""
                    }`}
                    strokeWidth={2.2}
                  />
                  <span className="hidden lg:inline">{item.label}</span>
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      <div className="hidden px-6 py-5 text-[10px] font-medium text-slate-300 lg:block">
        © ROYAL11
      </div>
    </aside>
  );
};
