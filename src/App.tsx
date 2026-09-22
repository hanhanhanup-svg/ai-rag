import EnterpriseApp from "./enterprise/EnterpriseApp";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import LoginPage from "@/pages/login/LoginPage";
import DashboardPage from "@/pages/dashboard";
import TodosPage from "@/pages/workspace/TodosPage";
import RecentPage from "@/pages/workspace/RecentPage";
import ActivityPage from "@/pages/workspace/ActivityPage";
import KnowledgeBasesPage from "@/pages/knowledge-bases";
import CatalogPage from "@/pages/assets/CatalogPage";
import TagsPage from "@/pages/tags";
import VersionsPage from "@/pages/assets/VersionsPage";
import UploadPage from "@/pages/upload";
import ProductionTasksPage from "@/pages/production/TasksPage";
import ReviewPage from "@/pages/review";
import SearchPage from "@/pages/search";
import ChatPage from "@/pages/application/ChatPage";
import ScenariosPage from "@/pages/application/ScenariosPage";
import FeedbackPage from "@/pages/application/FeedbackPage";
import FavoritesPage from "@/pages/application/FavoritesPage";
import KnowledgeMapPage from "@/pages/knowledge-map";
import QualityPage from "@/pages/quality";
import QualityRulesPage from "@/pages/quality-rules";
import GovernancePage from "@/pages/governance";
import GovernanceTasksPage from "@/pages/governance-tasks";
import ConflictsPage from "@/pages/governance/ConflictsPage";
import LifecyclePage from "@/pages/governance/LifecyclePage";
import PermissionsPage from "@/pages/permissions";
import KnowledgeAuthPolicyPage from "@/pages/permissions/KnowledgeAuthPolicyPage";
import {
  AccessLabelsPage,
  SecurityAlertsPage,
  SecurityAuditPage,
  SecurityLevelsPage,
  SecurityOverviewPage,
  SsoPage,
  UsersRolesPage
} from "@/pages/security/SecurityPages";
import ToolsPage from "@/pages/tools";
import SkillsPage from "@/pages/skills";
import OutputAdapterPage from "@/pages/output-adapter";
import ApiPage from "@/pages/api";
import { IntegrationAppsPage, IntegrationLogsPage, WebhooksPage } from "@/pages/integration/IntegrationPages";
import {
  BasicSettingsPage,
  DictionariesPage,
  ModelSettingsPage,
  NotificationSettingsPage,
  SystemLogsPage
} from "@/pages/settings/SettingsPages";

function LegacyPrototype() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route index element={<Navigate to="/workspace/overview" replace />} />

        <Route path="/workspace/overview" element={<DashboardPage />} />
        <Route path="/workspace/todos" element={<TodosPage />} />
        <Route path="/workspace/recent" element={<RecentPage />} />
        <Route path="/workspace/activity" element={<ActivityPage />} />

        <Route path="/assets/knowledge-bases" element={<KnowledgeBasesPage />} />
        <Route path="/assets/catalog" element={<CatalogPage />} />
        <Route path="/assets/tags" element={<TagsPage />} />
        <Route path="/assets/map" element={<KnowledgeMapPage />} />
        <Route path="/assets/versions" element={<VersionsPage />} />

        <Route path="/production/upload" element={<UploadPage />} />
        <Route path="/production/tasks" element={<ProductionTasksPage />} />
        <Route path="/production/skills" element={<SkillsPage />} />
        <Route path="/production/tools" element={<ToolsPage />} />
        <Route path="/production/runs" element={<Navigate to="/production/tasks" replace />} />

        <Route path="/application/search" element={<SearchPage />} />
        <Route path="/application/chat" element={<ChatPage />} />
        <Route path="/application/scenarios" element={<ScenariosPage />} />
        <Route path="/application/feedback" element={<FeedbackPage />} />
        <Route path="/application/favorites" element={<FavoritesPage />} />

        <Route path="/governance/quality" element={<QualityPage />} />
        <Route path="/governance/rules" element={<QualityRulesPage />} />
        <Route path="/governance/workbench" element={<GovernancePage />} />
        <Route path="/governance/tasks" element={<GovernanceTasksPage />} />
        <Route path="/governance/conflicts" element={<ConflictsPage />} />
        <Route path="/governance/lifecycle" element={<LifecyclePage />} />

        <Route path="/security/overview" element={<SecurityOverviewPage />} />
        <Route path="/security/levels" element={<SecurityLevelsPage />} />
        <Route path="/security/access-labels" element={<AccessLabelsPage />} />
        <Route path="/security/users" element={<UsersRolesPage />} />
        <Route path="/security/sso" element={<SsoPage />} />
        <Route path="/security/alerts" element={<SecurityAlertsPage />} />
        <Route path="/security/audit" element={<SecurityAuditPage />} />
        <Route path="/security/auth-policies" element={<KnowledgeAuthPolicyPage />} />

        <Route path="/integration/api" element={<ApiPage />} />
        <Route path="/integration/apps" element={<IntegrationAppsPage />} />
        <Route path="/integration/output" element={<OutputAdapterPage />} />
        <Route path="/integration/webhooks" element={<WebhooksPage />} />
        <Route path="/integration/logs" element={<IntegrationLogsPage />} />

        <Route path="/settings/basic" element={<BasicSettingsPage />} />
        <Route path="/settings/notifications" element={<NotificationSettingsPage />} />
        <Route path="/settings/dictionaries" element={<DictionariesPage />} />
        <Route path="/settings/models" element={<ModelSettingsPage />} />
        <Route path="/settings/logs" element={<SystemLogsPage />} />

        <Route path="/review" element={<ReviewPage />} />
        <Route path="/permissions" element={<PermissionsPage />} />

        <Route path="/dashboard" element={<Navigate to="/workspace/overview" replace />} />
        <Route path="/knowledge-bases" element={<Navigate to="/assets/knowledge-bases" replace />} />
        <Route path="/tags" element={<Navigate to="/assets/tags" replace />} />
        <Route path="/upload" element={<Navigate to="/production/upload" replace />} />
        <Route path="/search" element={<Navigate to="/application/search" replace />} />
        <Route path="/knowledge-map" element={<Navigate to="/assets/map" replace />} />
        <Route path="/quality" element={<Navigate to="/governance/quality" replace />} />
        <Route path="/quality-rules" element={<Navigate to="/governance/rules" replace />} />
        <Route path="/governance" element={<Navigate to="/governance/workbench" replace />} />
        <Route path="/governance-tasks" element={<Navigate to="/governance/tasks" replace />} />
        <Route path="/tools" element={<Navigate to="/production/tools" replace />} />
        <Route path="/skills" element={<Navigate to="/production/skills" replace />} />
        <Route path="/output-adapter" element={<Navigate to="/integration/output" replace />} />
        <Route path="/api" element={<Navigate to="/integration/api" replace />} />

        <Route path="*" element={<Navigate to="/workspace/overview" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() { return <EnterpriseApp />; }