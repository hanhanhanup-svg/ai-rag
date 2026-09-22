import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { getModuleByPath, routeTitleMap } from "@/routes/nav";

export function Breadcrumb() {
  const location = useLocation();
  const module = getModuleByPath(location.pathname);
  const title = routeTitleMap.get(location.pathname) ?? module?.title ?? "工作台";

  return (
    <div className="mb-5 flex items-center gap-2 text-sm text-slate-500">
      <Link to="/workspace/overview" className="hover:text-indigo-600">
        X-RAG
      </Link>
      <ChevronRight className="h-4 w-4" />
      {module && (
        <>
          <Link to={module.path} className="hover:text-indigo-600">
            {module.title}
          </Link>
          <ChevronRight className="h-4 w-4" />
        </>
      )}
      <span className="font-medium text-slate-700">{title}</span>
    </div>
  );
}
