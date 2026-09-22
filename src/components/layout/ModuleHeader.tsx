import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  Download,
  FilePlus2,
  FolderPlus,
  LogOut,
  RefreshCw,
  Search,
  ShieldPlus,
  Sparkles,
  UploadCloud,
  Wand2,
  UsersRound,
  UserPlus
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getVisibleModuleByPath } from "@/routes/nav";
import { useAppStore } from "@/store/useAppStore";
import { useAuthStore } from "@/auth/authStore";
import { SwitchRoleDialog } from "@/components/auth/SwitchRoleDialog";
import { cn } from "@/lib/utils";

function HeaderNotifications() {
  return (
    <button className="relative flex h-9 w-9 items-center justify-center rounded-2xl bg-white text-slate-500 shadow-sm ring-1 ring-slate-200/70 transition hover:bg-indigo-50 hover:text-indigo-600">
      <Bell className="h-4 w-4" />
      <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-amber-400" />
    </button>
  );
}

function HeaderUserProfile() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const currentUser = useAuthStore((state) => state.currentUser);
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="relative">
      <button
        className="flex h-9 items-center gap-2 rounded-2xl bg-white px-2.5 shadow-sm ring-1 ring-slate-200/70 transition hover:bg-indigo-50"
        onClick={() => setMenuOpen((open) => !open)}
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-cyan-400 text-xs font-semibold text-white">
          {currentUser?.avatarText ?? "X"}
        </div>
        <div className="hidden leading-tight xl:block">
          <p className="text-xs font-semibold text-slate-900">{currentUser?.name ?? "演示用户"}</p>
          <p className="text-[11px] text-slate-500">{currentUser?.roleName ?? "未登录"}</p>
        </div>
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-11 z-50 w-64 rounded-2xl border bg-white p-3 shadow-soft">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-sm font-semibold text-slate-950">{currentUser?.name}</p>
            <p className="mt-1 text-xs text-slate-500">{currentUser?.roleName}</p>
            <p className="mt-1 text-xs text-slate-500">业务域：{currentUser?.businessDomain}</p>
          </div>
          <div className="mt-2 space-y-1">
            <button
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-700"
              onClick={() => {
                setMenuOpen(false);
                setSwitchOpen(true);
              }}
            >
              <UsersRound className="h-4 w-4" />
              切换演示身份
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-red-50 hover:text-red-600"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4" />
              退出登录
            </button>
          </div>
        </div>
      )}
      <SwitchRoleDialog open={switchOpen} onOpenChange={setSwitchOpen} />
    </div>
  );
}

function ModuleActions({ moduleKey, pathname }: { moduleKey: string; pathname: string }) {
  const navigate = useNavigate();
  const addToast = useAppStore((state) => state.addToast);

  if (moduleKey === "assets") {
    return (
      <Button size="sm" onClick={() => navigate("/assets/knowledge-bases")}>
        <FolderPlus className="h-4 w-4" />
        新建知识库
      </Button>
    );
  }

  if (moduleKey === "production") {
    return (
      <>
        <Button size="sm" variant="outline" onClick={() => navigate("/production/upload")}>
          <UploadCloud className="h-4 w-4" />
          上传资料
        </Button>
        <Button size="sm" onClick={() => navigate("/production/skills")}>
          <FilePlus2 className="h-4 w-4" />
          新建技能
        </Button>
      </>
    );
  }

  if (moduleKey === "application") {
    return (
      <Button size="sm" onClick={() => navigate("/application/chat")}>
        <Sparkles className="h-4 w-4" />
        去问 AI
      </Button>
    );
  }

  if (moduleKey === "governance") {
    if (pathname === "/governance/quality") {
      return (
        <>
          <Button size="sm" variant="outline" onClick={() => addToast({ title: "体检报告已导出", type: "success" })}>
            <Download className="h-4 w-4" />
            导出体检报告
          </Button>
          <Button size="sm" onClick={() => addToast({ title: "知识体检完成", description: "共覆盖 54 条知识，发现 92 个待修复问题。", type: "success" })}>
            <RefreshCw className="h-4 w-4" />
            开始体检
          </Button>
        </>
      );
    }

    if (pathname === "/governance/workbench") {
      return (
        <>
          <Button size="sm" variant="outline" onClick={() => addToast({ title: "已为 54 条知识生成摘要", type: "success" })}>
            <Wand2 className="h-4 w-4" />
            一键生成摘要
          </Button>
          <Button size="sm" onClick={() => navigate("/governance/tasks")}>
            <FilePlus2 className="h-4 w-4" />
            批量创建任务
          </Button>
        </>
      );
    }

    if (pathname === "/governance/tasks") {
      return (
        <>
          <Button size="sm" variant="outline" onClick={() => addToast({ title: "已批量分派治理任务", type: "success" })}>
            <UsersRound className="h-4 w-4" />
            批量分派
          </Button>
          <Button size="sm" onClick={() => addToast({ title: "新建任务入口已打开", type: "info" })}>
            <FilePlus2 className="h-4 w-4" />
            新建任务
          </Button>
        </>
      );
    }

    if (pathname === "/governance/conflicts") {
      return (
        <>
          <Button size="sm" variant="outline" onClick={() => addToast({ title: "已批量合并疑似重复知识", type: "success" })}>
            批量合并
          </Button>
          <Button size="sm" onClick={() => addToast({ title: "已标记为不冲突", type: "success" })}>
            标记不冲突
          </Button>
        </>
      );
    }

    if (pathname === "/governance/lifecycle") {
      return (
        <>
          <Button size="sm" variant="outline" onClick={() => addToast({ title: "已发起复审", type: "success" })}>发起复审</Button>
          <Button size="sm" variant="outline" onClick={() => addToast({ title: "已批量延期", type: "success" })}>批量延期</Button>
          <Button size="sm" onClick={() => addToast({ title: "已批量下架", type: "warning" })}>批量下架</Button>
        </>
      );
    }

    if (pathname === "/governance/rules") {
      return (
        <Button size="sm" onClick={() => addToast({ title: "新建治理规则入口已打开", type: "info" })}>
          <FilePlus2 className="h-4 w-4" />
          新建规则
        </Button>
      );
    }

    return (
      <>
        <Button size="sm" variant="outline" onClick={() => addToast({ title: "知识体检完成", description: "共覆盖 54 条知识。", type: "success" })}>
          <RefreshCw className="h-4 w-4" />
          开始体检
        </Button>
        <Button size="sm" onClick={() => navigate("/governance/tasks")}>
          <FilePlus2 className="h-4 w-4" />
          新建治理任务
        </Button>
      </>
    );
  }

  if (moduleKey === "security") {
    return (
      <>
        <Button size="sm" variant="outline" onClick={() => addToast({ title: "审计日志已导出", type: "success" })}>
          导出审计日志
        </Button>
        <Button size="sm" onClick={() => addToast({ title: "安全策略已创建", description: "策略将在下一次安全扫描中生效。", type: "success" })}>
          <ShieldPlus className="h-4 w-4" />
          新建策略
        </Button>
      </>
    );
  }

  if (moduleKey === "integration") {
    return (
      <Button size="sm" onClick={() => navigate("/integration/apps")}>
        <UserPlus className="h-4 w-4" />
        新建应用
      </Button>
    );
  }

  return null;
}

export function ModuleHeader() {
  const location = useLocation();
  const currentUser = useAuthStore((state) => state.currentUser);
  const module = getVisibleModuleByPath(location.pathname, currentUser);

  if (!module) return null;

  return (
    <section className="mb-4 rounded-[1.45rem] border border-white/80 bg-white/[0.78] px-4 py-3 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-[240px] flex-1">
          <h1 className="text-xl font-semibold tracking-normal text-slate-950">{module.title}</h1>
          <p className="mt-1 max-w-4xl truncate text-sm text-slate-500">{module.description}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ModuleActions moduleKey={module.key} pathname={location.pathname} />
          <div className="relative w-[300px] max-w-[38vw]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="h-9 rounded-2xl bg-slate-50 pl-9 text-sm shadow-sm" placeholder={module.searchPlaceholder} />
          </div>
          <HeaderNotifications />
          <HeaderUserProfile />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {module.tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            className={({ isActive }) =>
              cn(
                "rounded-2xl px-3.5 py-1.5 text-sm font-medium text-slate-500 transition hover:bg-indigo-50 hover:text-indigo-700",
                isActive && "bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-glow hover:text-white"
              )
            }
          >
            {tab.title}
          </NavLink>
        ))}
      </div>
    </section>
  );
}
