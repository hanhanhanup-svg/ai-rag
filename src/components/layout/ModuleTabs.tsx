import { NavLink, useLocation } from "react-router-dom";
import { getModuleByPath } from "@/routes/nav";
import { cn } from "@/lib/utils";

export function ModuleTabs() {
  const location = useLocation();
  const module = getModuleByPath(location.pathname);

  if (!module) return null;

  return (
    <div className="mb-7 rounded-[1.35rem] border border-white/80 bg-white/[0.86] p-2 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        {module.tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            className={({ isActive }) =>
              cn(
                "rounded-2xl px-4 py-2.5 text-sm font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-900",
                isActive && "bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-glow hover:text-white"
              )
            }
          >
            {tab.title}
          </NavLink>
        ))}
      </div>
    </div>
  );
}
