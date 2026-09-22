import { GitMerge, PlusCircle } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { qualityConflicts } from "@/data/mock/quality";
import { useAppStore } from "@/store/useAppStore";

const conflictRows = qualityConflicts.map((item, index) => ({
  id: `CONF-${String(index + 1).padStart(3, "0")}`,
  a: item.a,
  b: item.b,
  similarity: item.similarity,
  type: ["重复知识", "内容冲突", "版本冲突", "跨库冲突"][index % 4],
  recommend: ["合并为新知识", "保留 A", "设为当前版本", "两者都正确"][index % 4],
  status: index === 0 ? "待处理" : index === 1 ? "处理中" : "待确认"
}));

export default function ConflictsPage() {
  const addToast = useAppStore((state) => state.addToast);

  return (
    <div className="space-y-6">
      <PageHeader
        title="冲突合并"
        description="识别重复知识、答案冲突和版本冲突，支持保留、合并或标记为不冲突。"
        actions={
          <>
            <Button variant="outline" onClick={() => addToast({ title: "已批量合并疑似重复知识", type: "success" })}>
              <GitMerge className="h-4 w-4" />
              批量合并
            </Button>
            <Button onClick={() => addToast({ title: "已标记为不冲突", type: "success" })}>标记不冲突</Button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        {["重复知识", "内容冲突", "版本冲突", "跨库冲突"].map((type, index) => (
          <div key={type} className="rounded-2xl border bg-white p-5 shadow-soft">
            <p className="text-sm text-slate-500">{type}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{index === 0 ? 2 : 1}</p>
          </div>
        ))}
      </div>

      <SectionCard title="冲突合并建议" description="左右对比查看知识差异，选择保留、合并或加入治理任务。">
        <div className="space-y-4">
          {conflictRows.map((row) => (
            <div key={row.id} className="rounded-3xl border bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{row.id}</Badge>
                  <Badge variant="warning">{row.type}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="default">相似度 {row.similarity}</Badge>
                  <Badge variant="secondary">{row.status}</Badge>
                </div>
              </div>
              <div className="grid gap-4 lg:grid-cols-[1fr_180px_1fr]">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-medium text-slate-500">条目 A</p>
                  <p className="mt-3 font-semibold text-slate-950">{row.a}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-500">来自员工制度知识库，当前被多个问答场景引用。</p>
                </div>
                <div className="flex flex-col items-center justify-center rounded-2xl bg-indigo-50 p-4 text-center">
                  <GitMerge className="h-6 w-6 text-indigo-600" />
                  <p className="mt-2 text-sm font-semibold text-indigo-700">{row.recommend}</p>
                  <p className="mt-1 text-xs text-indigo-500">推荐处理</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-medium text-slate-500">条目 B</p>
                  <p className="mt-3 font-semibold text-slate-950">{row.b}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-500">来自同主题流程或版本记录，内容需要人工确认。</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {["保留 A", "保留 B", "合并为新知识", "两者都正确"].map((op) => (
                  <Button key={op} size="sm" variant="outline" onClick={() => addToast({ title: `已选择：${op}`, description: row.id, type: "success" })}>{op}</Button>
                ))}
                <Button size="sm" onClick={() => addToast({ title: "已加入治理任务", description: row.id, type: "success" })}>
                  <PlusCircle className="h-4 w-4" />
                  加入治理任务
                </Button>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
