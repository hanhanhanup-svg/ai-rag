import type { CurrentUser } from "@/auth/roles";

const platformOnlyPaths = ["/settings", "/security/users", "/security/sso", "/integration/api"];

const routeModuleMap: Record<string, string> = {
  workspace: "workspace",
  assets: "assets",
  production: "production",
  application: "application",
  governance: "governance",
  security: "security",
  integration: "integration",
  settings: "settings",
  review: "governance",
  permissions: "security"
};

export function hasPermission(user: CurrentUser | null | undefined, permission: string) {
  if (!user) return false;
  return user.permissions.includes("all") || user.permissions.includes(permission);
}

export function canAccessModule(user: CurrentUser | null | undefined, moduleKey: string) {
  if (!user) return false;
  if (hasPermission(user, "all")) return true;
  if (moduleKey === "settings") return false;
  if (moduleKey === "security") return hasPermission(user, "security") || hasPermission(user, "security_limited");
  if (moduleKey === "integration") return hasPermission(user, "integration") || hasPermission(user, "integration_limited");
  return hasPermission(user, moduleKey);
}

export function canAccessPath(user: CurrentUser | null | undefined, pathname: string) {
  if (!user) return false;
  if (hasPermission(user, "all")) return true;

  if (platformOnlyPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return false;
  }

  const segment = pathname.split("/").filter(Boolean)[0] ?? "workspace";
  const moduleKey = routeModuleMap[segment];
  if (!moduleKey) return true;
  return canAccessModule(user, moduleKey);
}

export function canAccessKnowledgeBase(user: CurrentUser | null | undefined, knowledgeBaseName: string) {
  if (!user) return false;
  return user.accessibleKnowledgeBases.includes("all") || user.accessibleKnowledgeBases.includes(knowledgeBaseName);
}
