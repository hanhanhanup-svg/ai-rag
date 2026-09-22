import { Settings2 } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { applicationScenarios } from "@/data/mock/workspace";
import { useAppStore } from "@/store/useAppStore";

export default function ScenariosPage() {
  const addToast = useAppStore((state) => state.addToast);
  return (
    <div className="space-y-6">
      <PageHeader title="应用场景" description="查看可信知识正在服务哪些业务场景，以及命中率和调用量表现。" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {applicationScenarios.map((scene) => (
          <SectionCard key={scene.id} title={scene.name} description={`${scene.type} · 负责人 ${scene.owner}`}>
            <div className="space-y-3 text-sm text-slate-600">
              <p>接入知识库：{scene.knowledgeBase}</p>
              <p>最高密级：{scene.maxSensitivity}</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-indigo-50 p-3"><p className="text-xs text-slate-500">调用量</p><p className="text-xl font-semibold">{scene.calls}</p></div>
                <div className="rounded-2xl bg-emerald-50 p-3"><p className="text-xs text-slate-500">命中率</p><p className="text-xl font-semibold">{scene.hitRate}</p></div>
              </div>
              <div className="flex items-center justify-between">
                <StatusBadge status={scene.status} />
                <Badge variant="outline">{scene.type}</Badge>
              </div>
              <div className="flex gap-2 pt-2">
                <Button size="sm" variant="outline" onClick={() => addToast({ title: "已打开应用详情", description: scene.name })}>查看详情</Button>
                <Button size="sm" onClick={() => addToast({ title: "知识范围配置已更新", description: scene.name, type: "success" })}><Settings2 className="h-4 w-4" />配置知识范围</Button>
              </div>
            </div>
          </SectionCard>
        ))}
      </div>
    </div>
  );
}
