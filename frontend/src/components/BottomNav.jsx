import { NavLink } from "react-router-dom";
import { motion } from "framer-motion";
import { NAV_ITEMS as ITEMS } from "@/lib/navItems";

export const BottomNav = () => {
  return (
    <nav
      data-testid="bottom-nav"
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-100 bg-white/80 backdrop-blur-xl md:hidden"
    >
      <div className="mx-auto flex max-w-2xl items-stretch justify-between px-3 py-2 sm:px-6">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.id}
              to={item.to}
              end={item.to === "/"}
              data-testid={`nav-${item.id}`}
              className="group relative flex flex-1 flex-col items-center gap-1 py-1.5"
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="nav-pill"
                      className="absolute inset-x-2 -top-0.5 h-11 rounded-2xl bg-royal-light"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    />
                  )}
                  <Icon
                    className={`relative h-[22px] w-[22px] transition-colors ${
                      isActive ? "text-royal" : "text-slate-400 group-hover:text-slate-600"
                    }`}
                    strokeWidth={2.2}
                  />
                  <span
                    className={`relative text-[11px] font-semibold transition-colors ${
                      isActive ? "text-royal" : "text-slate-400 group-hover:text-slate-600"
                    }`}
                  >
                    {item.label}
                  </span>
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
};
