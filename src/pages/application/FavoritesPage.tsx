import { Heart, Search, Star } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { knowledgeBases } from "@/data/mock/knowledgeBases";
import { knowledgeItems } from "@/data/mock/knowledgeItems";
import { useAuthStore } from "@/auth/authStore";
import { filterKnowledgeBasesByRole, filterKnowledgeItemsByRole, getRoleSearchSuggestions } from "@/lib/roleDataFilter";

export default function FavoritesPage() {
  const navigate = useNavigate();
  const currentUser = useAuthStore((state) => state.currentUser);
  const scopedKnowledgeBases = filterKnowledgeBasesByRole(currentUser, knowledgeBases);
  const scopedKnowledgeItems = filterKnowledgeItemsByRole(currentUser, knowledgeItems);
  const scopedSearches = getRoleSearchSuggestions(currentUser).slice(0, 5);
  return (
    <div className="space-y-6">
      <PageHeader title="收藏与常用" description="整理你常用的知识、搜索词和知识库，让日常工作更快。" />
      <div className="grid gap-6 xl:grid-cols-3">
        <SectionCard title="收藏知识">
          <div className="space-y-3">
            {scopedKnowledgeItems.slice(0, 6).map((item) => (
              <div key={item.id} className="rounded-2xl bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{item.title}</p>
                  <Heart className="h-4 w-4 text-rose-400" />
                </div>
                <p className="mt-2 text-sm text-slate-500">{item.type} · 质量分 {item.qualityScore}</p>
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="常用搜索">
          <div className="flex flex-wrap gap-2">
            {scopedSearches.map((item) => (
              <Button key={item} size="sm" variant="outline" onClick={() => navigate("/application/search")}>
                <Search className="h-4 w-4" />
                {item}
              </Button>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="常用知识库">
          <div className="space-y-3">
            {scopedKnowledgeBases.slice(0, 5).map((kb) => (
              <div key={kb.id} className="flex items-center justify-between rounded-2xl bg-slate-50 p-4">
                <div>
                  <p className="font-medium">{kb.name}</p>
                  <p className="text-sm text-slate-500">{kb.type}</p>
                </div>
                <Badge variant="secondary"><Star className="mr-1 h-3 w-3" />常用</Badge>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
