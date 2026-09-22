import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "@/components/layout/Sidebar";
import { ModuleHeader } from "@/components/layout/ModuleHeader";
import { ToastViewport } from "@/components/common/Toast";
import { AccessRestrictedPage } from "@/components/auth/AccessRestrictedPage";
import { KnowledgeClickEffect } from "@/components/effects/KnowledgeClickEffect";
import { KnowledgeTextBackground } from "@/components/effects/KnowledgeTextBackground";
import { useAuthStore } from "@/auth/authStore";
import { canAccessPath } from "@/lib/permissions";

export function AppLayout() {
  const location = useLocation();
  const currentUser = useAuthStore((state) => state.currentUser);
  const blocked = Boolean(currentUser && !canAccessPath(currentUser, location.pathname));

  return (
    <div className="relative min-h-screen bg-slate-50">
      <KnowledgeTextBackground />
      <Sidebar />
      <div className="relative z-10 pl-64">
        <main className="relative mx-auto min-h-screen max-w-[1600px] px-6 py-4">
          <ModuleHeader />
          {blocked ? <AccessRestrictedPage /> : <Outlet />}
        </main>
      </div>
      <KnowledgeClickEffect />
      <ToastViewport />
    </div>
  );
}
