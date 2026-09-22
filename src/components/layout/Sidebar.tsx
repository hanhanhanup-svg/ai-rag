import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { getVisibleModuleByPath, getVisibleModules } from "@/routes/nav";
import { useAuthStore } from "@/auth/authStore";
import { AnimatedLogo } from "@/components/effects/AnimatedLogo";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const location = useLocation();
  const currentUser = useAuthStore((state) => state.currentUser);
  const visibleModules = getVisibleModules(currentUser);
  const activeModule = getVisibleModuleByPath(location.pathname, currentUser);

  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-[#11162A] text-white">
      <AnimatedLogo />
      <nav className="subtle-scrollbar flex-1 overflow-y-auto px-4 pb-6 pt-2">
        <div className="space-y-2">
          {visibleModules.map((item) => {
            const isActive = activeModule?.path === item.path;

            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "group flex items-center gap-3 rounded-2xl px-3.5 py-3 text-sm text-slate-300 transition-all hover:bg-white/[0.09] hover:text-white",
                  isActive && "bg-white text-slate-950 shadow-soft"
                )}
              >
                <>
                  <span
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.08] text-slate-300 transition",
                      isActive && "bg-indigo-50 text-indigo-600"
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{item.title}</span>
                    <span className={cn("mt-0.5 block truncate text-xs text-slate-500", isActive && "text-slate-500")}>{item.description}</span>
                  </span>
                  {isActive && <ChevronRight className="h-4 w-4 text-indigo-500" />}
                </>
              </Link>
            );
          })}
        </div>
      </nav>
      <div className="m-4 rounded-3xl border border-white/10 bg-white/[0.08] p-4">
        <p className="text-sm font-medium">{currentUser?.roleName ?? "演示身份"}</p>
        <p className="mt-1 text-xs leading-5 text-slate-400">
          {currentUser?.businessDomain ?? "知识业务域"} · 最高密级 {currentUser?.maxSensitivityLevel ?? "L2"}
        </p>
      </div>
    </aside>
  );
}
