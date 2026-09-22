import type { CurrentUser } from "@/auth/roles";
import type { KnowledgeBase, KnowledgeItem } from "@/types";
import { canAccessKnowledgeBase } from "@/lib/permissions";
import {
  chatScenarios,
  roleDashboardStats,
  roleScopedKnowledgeItems,
  roleSearchSuggestions,
  type RoleDashboardStats
} from "@/data/mock/roleScopedData";

const fallbackStats: RoleDashboardStats = roleDashboardStats.super_admin;

function getRoleKey(user: CurrentUser | null | undefined) {
  return user?.username ?? "super_admin";
}

export function filterKnowledgeBasesByRole(user: CurrentUser | null | undefined, knowledgeBases: KnowledgeBase[]) {
  if (!user) return [];
  if (user.accessibleKnowledgeBases.includes("all")) return knowledgeBases;
  return knowledgeBases.filter((item) => canAccessKnowledgeBase(user, item.name));
}

export function filterKnowledgeItemsByRole(user: CurrentUser | null | undefined, knowledgeItems: KnowledgeItem[]) {
  if (!user) return [];

  const merged = new Map<string, KnowledgeItem>();
  [...knowledgeItems, ...roleScopedKnowledgeItems].forEach((item) => merged.set(item.id, item));
  const items = Array.from(merged.values());

  if (user.accessibleKnowledgeBases.includes("all")) return items;
  return items.filter((item) => canAccessKnowledgeBase(user, item.knowledgeBase));
}

export function getRoleDashboardStats(user: CurrentUser | null | undefined) {
  return roleDashboardStats[getRoleKey(user)] ?? fallbackStats;
}

export function getRoleSearchSuggestions(user: CurrentUser | null | undefined) {
  return roleSearchSuggestions[getRoleKey(user)] ?? roleSearchSuggestions.super_admin;
}

export function getRoleChatScenarios(user: CurrentUser | null | undefined) {
  if (!user || user.permissions.includes("all")) return chatScenarios;
  if (user.username === "marketing_admin") return chatScenarios.filter((scenario) => scenario.domain === "marketing");
  if (user.username === "hr_admin") return chatScenarios.filter((scenario) => scenario.domain === "hr");
  return [];
}

export function getAllRoleChatScenarios() {
  return chatScenarios;
}
