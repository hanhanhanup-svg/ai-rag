import { useNavigate } from "react-router-dom";
import { Clock3, Database, Search } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { knowledgeBases } from "@/data/mock/knowledgeBases";
import { knowledgeItems } from "@/data/mock/knowledgeItems";
import { useAuthStore } from "@/auth/authStore";
import { filterKnowledgeBasesByRole, filterKnowledgeItemsByRole, getRoleSearchSuggestions } from "@/lib/roleDataFilter";

export default function RecentPage() {
  const navigate = useNavigate();
  const currentUser = useAuthStore((state) => state.currentUser);
  const scopedKnowledgeBases = filterKnowledgeBasesByRole(currentUser, knowledgeBases);
  const scopedKnowledgeItems = filterKnowledgeItemsByRole(currentUser, knowledgeItems);
  const scopedRecentSearches = getRoleSearchSuggestions(currentUser).slice(0, 4);

  return (
    <div className="space-y-6">
      <PageHeader title="最近使用" description="快速回到最近打开的知识库、搜索词和查看过的知识。" />
      <div className="grid gap-6 xl:grid-cols-3">
        <SectionCard title="最近打开的知识库">
          <div className="space-y-3">
            {scopedKnowledgeBases.slice(0, 5).map((kb) => (
              <button key={kb.id} onClick={() => navigate("/assets/knowledge-bases")} className="flex w-full items-center gap-3 rounded-2xl bg-slate-50 p-4 text-left hover:bg-indigo-50">
                <Database className="h-5 w-5 text-indigo-500" />
                <div>
                  <p className="font-medium">{kb.name}</p>
                  <p className="text-xs text-slate-500">{kb.type} · {kb.itemCount} 条知识</p>
                </div>
              </button>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="最近搜索">
          <div className="flex flex-wrap gap-2">
            {scopedRecentSearches.map((item) => (
              <Button key={item} variant="outline" size="sm" onClick={() => navigate("/application/search")}>
                <Search className="h-4 w-4" />
                {item}
              </Button>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="最近查看知识">
          <div className="space-y-3">
            {scopedKnowledgeItems.slice(0, 5).map((item) => (
              <div key={item.id} className="rounded-2xl bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate font-medium">{item.title}</p>
                  <Badge variant="secondary">{item.type}</Badge>
                </div>
                <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
                  <Clock3 className="h-3 w-3" />
                  {item.updatedAt}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
