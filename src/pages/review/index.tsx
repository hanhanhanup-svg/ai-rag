import { useMemo, useState } from "react";
import { CheckCheck, Edit3, FileSearch, RotateCcw, Search, ThumbsDown, ThumbsUp } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { FilterBar } from "@/components/common/FilterBar";
import { DataTable, type TableColumn } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { KnowledgeTypeBadge } from "@/components/common/KnowledgeTypeBadge";
import { SensitivityBadge } from "@/components/common/SensitivityBadge";
import { DetailDrawer } from "@/components/drawers/DetailDrawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/store/useAppStore";
import type { ReviewTask } from "@/types";

export default function ReviewPage() {
  const [selected, setSelected] = useState<ReviewTask | null>(null);
  const [typeFilter, setTypeFilter] = useState("全部类型");
  const reviewTasks = useAppStore((state) => state.reviewTasks);
  const updateReviewStatus = useAppStore((state) => state.updateReviewStatus);
  const addToast = useAppStore((state) => state.addToast);

  const visibleTasks = useMemo(
    () => reviewTasks.filter((task) => typeFilter === "全部类型" || task.type === typeFilter).slice(0, 12),
    [reviewTasks, typeFilter]
  );

  const approve = (task: ReviewTask) => {
    updateReviewStatus(task.id, "已通过");
    addToast({ title: "审核通过", description: `${task.title} 已进入知识库。`, type: "success" });
  };

  const reject = (task: ReviewTask) => {
    updateReviewStatus(task.id, "已驳回");
    addToast({ title: "已驳回候选知识", description: "可在审核记录中查看驳回原因。", type: "warning" });
  };

  const columns: TableColumn<ReviewTask>[] = [
    { key: "type", title: "知识类型", render: (row) => <KnowledgeTypeBadge type={row.type} /> },
    { key: "status", title: "状态", render: (row) => <StatusBadge status={row.status} /> },
    { key: "confidence", title: "置信度", render: (row) => row.confidence.toFixed(2) },
    { key: "kb", title: "所属知识库", render: (row) => row.knowledgeBase },
    { key: "source", title: "来源", render: (row) => row.source },
    { key: "time", title: "提交时间", render: (row) => row.submittedAt },
    { key: "title", title: "标题", render: (row) => <span className="font-medium text-slate-900">{row.title}</span> },
    { key: "file", title: "来源文件", render: (row) => row.sourceFile },
    { key: "user", title: "提交人", render: (row) => row.submitter },
    {
      key: "op",
      title: "操作",
      render: (row) => (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="success" onClick={() => approve(row)}><ThumbsUp className="h-4 w-4" />通过</Button>
          <Button size="sm" variant="outline"><Edit3 className="h-4 w-4" />编辑</Button>
          <Button size="sm" variant="outline" onClick={() => reject(row)}><ThumbsDown className="h-4 w-4" />驳回</Button>
          <Button size="sm" onClick={() => setSelected(row)}><FileSearch className="h-4 w-4" />详情</Button>
        </div>
      )
    }
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="审核工作台"
        description="集中审核 AI 抽取生成的知识候选项，确认后进入正式知识库。"
        actions={
          <>
            <Button variant="outline" onClick={() => addToast({ title: "批量驳回完成", description: "已模拟处理所选候选项。", type: "warning" })}>批量驳回</Button>
            <Button onClick={() => addToast({ title: "批量通过完成", description: "高置信候选项已进入知识库。", type: "success" })}><CheckCheck className="h-4 w-4" />批量通过（高置信）</Button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard label="今日待处理" value="0" hint="今日新增" tone="muted" />
        <StatCard label="今日已审核" value="0" hint="待启动" tone="muted" />
        <StatCard label="超过 SLA" value="75" hint="需优先处理" tone="danger" />
        <StatCard label="平均审核时长" value="2.3h" hint="近 30 天" tone="normal" />
        <StatCard label="驳回率" value="0.0%" hint="当前批次" tone="success" />
      </div>

      <FilterBar>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300" />
          全选
        </label>
        <div className="w-40">
          <Select defaultValue="全部知识库">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="全部知识库">全部知识库</SelectItem>
              <SelectItem value="测试知识库">测试知识库</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-36">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {["全部类型", "FAQ", "SOP", "text_chunk"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="w-36">
          <Select defaultValue="全部来源">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="全部来源">全部来源</SelectItem>
              <SelectItem value="AI 提取">AI 提取</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline">置信度</Button>
        <Button variant="outline">SLA 状态</Button>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-10" placeholder="搜索条目" />
        </div>
        <Badge variant="secondary">已选 0</Badge>
      </FilterBar>

      <DataTable columns={columns} data={visibleTasks} rowKey={(row) => row.id} />

      <DetailDrawer
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
        title={selected?.title ?? "审核详情"}
        description="对照原文依据，确认 AI 抽取结果是否可以入库。"
        widthClassName="w-[980px]"
        footer={
          selected && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => addToast({ title: "已保存修改", type: "success" })}>保存修改</Button>
              <Button variant="outline" onClick={() => addToast({ title: "已退回重抽", description: "系统会重新执行抽取技能。", type: "warning" })}><RotateCcw className="h-4 w-4" />退回重抽</Button>
              <Button variant="destructive" onClick={() => reject(selected)}>驳回</Button>
              <Button variant="success" onClick={() => approve(selected)}>通过</Button>
            </div>
          )
        }
      >
        {selected && (
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="rounded-2xl border bg-slate-50 p-5">
              <h3 className="font-semibold text-slate-950">原文依据</h3>
              <p className="mt-3 leading-7 text-slate-700">{selected.originalText}</p>
              <div className="mt-5 grid gap-3 text-sm">
                <p><span className="text-slate-500">来源文件：</span>{selected.sourceFile}</p>
                <p><span className="text-slate-500">页码：</span>{selected.page}</p>
                <p><span className="text-slate-500">段落：</span>{selected.paragraph}</p>
              </div>
            </section>
            <section className="rounded-2xl border bg-white p-5">
              <h3 className="font-semibold text-slate-950">AI 抽取结果</h3>
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-xs text-slate-500">标题</p>
                  <p className="mt-1 font-medium">{selected.title}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">摘要</p>
                  <p className="mt-1 leading-6 text-slate-700">{selected.summary}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">正文</p>
                  <p className="mt-1 leading-6 text-slate-700">{selected.content}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <KnowledgeTypeBadge type={selected.type} />
                  <SensitivityBadge level={selected.sensitivity} />
                  <Badge variant="outline">置信度 {Math.round(selected.confidence * 100)}%</Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selected.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                </div>
              </div>
            </section>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}
