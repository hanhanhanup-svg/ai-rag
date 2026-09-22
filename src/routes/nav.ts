import {
  Bell,
  BookOpen,
  Boxes,
  BrainCircuit,
  BriefcaseBusiness,
  Building2,
  CircleGauge,
  FileClock,
  FolderKanban,
  GitBranch,
  Home,
  KeyRound,
  Layers3,
  LibraryBig,
  LifeBuoy,
  Map as MapIcon,
  MessageSquareText,
  Network,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Tags,
  UploadCloud,
  UsersRound,
  Webhook,
  Wrench
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CurrentUser } from "@/auth/roles";
import { canAccessModule, canAccessPath } from "@/lib/permissions";

export interface ModuleTab {
  title: string;
  path: string;
  allowedRoles?: string[];
}

export interface ModuleNavItem {
  key: string;
  title: string;
  path: string;
  icon: LucideIcon;
  description: string;
  searchPlaceholder: string;
  tabs: ModuleTab[];
  allowedRoles?: string[];
}

export const moduleNavItems: ModuleNavItem[] = [
  {
    key: "workspace",
    title: "工作台",
    path: "/workspace/overview",
    icon: Home,
    description: "查看我的待办、常用知识、平台运行状态和近期知识动态。",
    searchPlaceholder: "搜索知识、待办或最近使用内容...",
    tabs: [
      { title: "总览", path: "/workspace/overview" },
      { title: "我的待办", path: "/workspace/todos" },
      { title: "最近使用", path: "/workspace/recent" },
      { title: "运营动态", path: "/workspace/activity" }
    ]
  },
  {
    key: "assets",
    title: "知识资产",
    path: "/assets/knowledge-bases",
    icon: LibraryBig,
    description: "统一管理知识库、目录、标签、知识地图和版本记录。",
    searchPlaceholder: "搜索知识库、目录或标签...",
    tabs: [
      { title: "知识库", path: "/assets/knowledge-bases" },
      { title: "知识目录", path: "/assets/catalog" },
      { title: "标签体系", path: "/assets/tags" },
      { title: "知识地图", path: "/assets/map" },
      { title: "版本记录", path: "/assets/versions" }
    ]
  },
  {
    key: "production",
    title: "知识生产",
    path: "/production/upload",
    icon: UploadCloud,
    description: "把文件、网页、表格等资料自动整理成可审核、可搜索、可问答的知识。",
    searchPlaceholder: "搜索任务、文件或技能...",
    tabs: [
      { title: "文件上传", path: "/production/upload" },
      { title: "抽取任务", path: "/production/tasks" },
      { title: "抽取技能", path: "/production/skills" },
      { title: "工具库", path: "/production/tools" }
    ]
  },
  {
    key: "application",
    title: "知识应用",
    path: "/application/search",
    icon: MessageSquareText,
    description: "面向业务用户提供知识搜索、智能问答、场景应用和反馈闭环。",
    searchPlaceholder: "搜索知识、问答或场景...",
    tabs: [
      { title: "智能问答", path: "/application/chat" },
      { title: "知识搜索", path: "/application/search" },
      { title: "应用场景", path: "/application/scenarios" },
      { title: "收藏与常用", path: "/application/favorites" },
      { title: "用户反馈", path: "/application/feedback" }
    ]
  },
  {
    key: "governance",
    title: "质量治理",
    path: "/governance/quality",
    icon: CircleGauge,
    description: "持续体检知识健康状态，发现摘要缺失、重复冲突、过期失效等问题，并推动知识修复、复审和下架闭环。",
    searchPlaceholder: "搜索质量问题或治理任务...",
    tabs: [
      { title: "知识体检", path: "/governance/quality" },
      { title: "问题清单", path: "/governance/workbench" },
      { title: "治理任务", path: "/governance/tasks" },
      { title: "冲突合并", path: "/governance/conflicts" },
      { title: "复审下架", path: "/governance/lifecycle" },
      { title: "治理规则", path: "/governance/rules" }
    ]
  },
  {
    key: "security",
    title: "权限安全",
    path: "/security/overview",
    icon: ShieldCheck,
    description: "按角色、业务域、密级和访问标签控制知识使用范围。",
    searchPlaceholder: "搜索角色、权限或审计记录...",
    tabs: [
      { title: "权限概览", path: "/security/overview" },
      { title: "密级配置", path: "/security/levels", allowedRoles: ["超级管理员", "企业管理员", "安全管理员"] },
      { title: "访问标签", path: "/security/access-labels" },
      { title: "用户与角色", path: "/security/users", allowedRoles: ["超级管理员", "企业管理员", "安全管理员"] },
      { title: "SSO 配置", path: "/security/sso", allowedRoles: ["超级管理员", "企业管理员"] },
      { title: "安全告警", path: "/security/alerts", allowedRoles: ["超级管理员", "企业管理员", "安全管理员"] },
      { title: "知识鉴权策略", path: "/security/auth-policies", allowedRoles: ["超级管理员", "企业管理员", "安全管理员"] },
      { title: "操作审计", path: "/security/audit" }
    ]
  },
  {
    key: "integration",
    title: "开放集成",
    path: "/integration/api",
    icon: GitBranch,
    description: "将可信知识安全接入业务系统、智能助手和第三方应用。",
    searchPlaceholder: "搜索应用、API 或调用日志...",
    tabs: [
      { title: "API 管理", path: "/integration/api" },
      { title: "应用接入", path: "/integration/apps" },
      { title: "输出适配", path: "/integration/output" },
      { title: "Webhook", path: "/integration/webhooks" },
      { title: "调用日志", path: "/integration/logs" }
    ]
  },
  {
    key: "settings",
    title: "系统设置",
    path: "/settings/basic",
    icon: Settings,
    description: "配置平台基础参数、通知策略、字典、模型和系统日志。",
    searchPlaceholder: "搜索配置项...",
    tabs: [
      { title: "基础设置", path: "/settings/basic" },
      { title: "通知设置", path: "/settings/notifications" },
      { title: "字典配置", path: "/settings/dictionaries" },
      { title: "模型配置", path: "/settings/models" },
      { title: "系统日志", path: "/settings/logs" }
    ]
  }
];

export const routeTitleMap = new Map(
  moduleNavItems.flatMap((module) => module.tabs.map((tab) => [tab.path, tab.title] as const))
);

export function getModuleByPath(pathname: string) {
  return moduleNavItems.find((module) => pathname === module.path || module.tabs.some((tab) => pathname === tab.path));
}

export const currentRole = "企业管理员";

export function isAllowed(allowedRoles?: string[], role = currentRole) {
  return !allowedRoles || allowedRoles.includes(role);
}

export function getVisibleModules(user?: CurrentUser | null) {
  return moduleNavItems
    .filter((module) => (!user ? true : canAccessModule(user, module.key)))
    .map((module) => ({
      ...module,
      title: module.key === "integration" && user && !user.permissions.includes("all") ? "开放集成（有限）" : module.title,
      tabs: module.tabs.filter((tab) => (!user ? isAllowed(tab.allowedRoles) : canAccessPath(user, tab.path)))
    }))
    .filter((module) => module.tabs.length > 0)
    .map((module) => ({
      ...module,
      path: module.tabs[0]?.path ?? module.path
    }));
}

export function getVisibleModuleByPath(pathname: string, user?: CurrentUser | null) {
  return getVisibleModules(user).find((module) => pathname === module.path || module.tabs.some((tab) => pathname === tab.path));
}

export const quickEntryItems = [
  { title: "搜知识", path: "/application/search", icon: Search },
  { title: "问 AI", path: "/application/chat", icon: Sparkles },
  { title: "上传资料", path: "/production/upload", icon: UploadCloud },
  { title: "处理审核", path: "/workspace/todos", icon: BrainCircuit },
  { title: "知识体检", path: "/governance/quality", icon: CircleGauge },
  { title: "新建知识库", path: "/assets/knowledge-bases", icon: BookOpen }
];

export const moduleIconHints = {
  assets: [BookOpen, Tags, MapIcon, FileClock],
  production: [UploadCloud, Wrench, BrainCircuit, Boxes],
  application: [Search, MessageSquareText, BriefcaseBusiness, LifeBuoy],
  security: [ShieldCheck, UsersRound, Building2, KeyRound],
  integration: [Network, Webhook, Layers3, GitBranch],
  settings: [Bell, Settings, FolderKanban]
};
