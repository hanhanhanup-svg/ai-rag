import { useNavigate } from "react-router-dom";
import { CalendarClock, FileCheck2, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { MetricCard } from "@/components/common/MetricCard";
import { SectionCard } from "@/components/common/SectionCard";
import { DataTable, type TableColumn } from "@/components/common/DataTable";
import { KnowledgeTypeBadge } from "@/components/common/KnowledgeTypeBadge";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { reviewTasks } from "@/data/mock/reviewTasks";
import { governanceTasks } from "@/data/mock/quality";
import { lifecycleItems } from "@/data/mock/workspace";
import type { ReviewTask } from "@/types";

export default function TodosPage() {
  const navigate = useNavigate();
  const columns: TableColumn<ReviewTask>[] = [
    { key: "type", title: "类型", render: (row) => <KnowledgeTypeBadge type={row.type} /> },
    { key: "title", title: "标题", render: (row) => <span className="font-medium text-slate-900">{row.title}</span> },
    { key: "kb", title: "知识库", render: (row) => row.knowledgeBase },
    { key: "confidence", title: "置信度", render: (row) => `${Math.round(row.confidence * 100)}%` },
    { key: "sla", title: "状态", render: (row) => <StatusBadge status={row.sla} /> },
    { key: "op", title: "操作", render: () => <Button size="sm" onClick={() => navigate("/review")}>去审核</Button> }
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="我的待办" description="把审核、治理和到期复审放在一个页面，优先处理影响知识可信度的事项。" />
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard title="待审核知识" value="78" description="75 条已超过 SLA" icon={<FileCheck2 className="h-5 w-5 text-amber-500" />} />
        <MetricCard title="待治理任务" value={governanceTasks.filter((task) => task.status !== "已完成").length} description="摘要与问题变体优先" icon={<Sparkles className="h-5 w-5 text-indigo-500" />} />
        <MetricCard title="到期复审" value={lifecycleItems.filter((item) => item.status !== "正常").length} description="即将到期或已过期" icon={<CalendarClock className="h-5 w-5 text-rose-500" />} />
      </div>
      <SectionCard title="待审核知识" description="建议先处理高置信且已超时的候选知识。">
        <DataTable columns={columns} data={reviewTasks.slice(0, 8)} rowKey={(row) => row.id} />
      </SectionCard>
      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="待治理任务">
          <div className="space-y-3">
            {governanceTasks.filter((task) => task.status !== "已完成").map((task) => (
              <div key={task.id} className="flex items-center justify-between rounded-2xl border bg-white p-4">
                <div>
                  <p className="font-medium">{task.title}</p>
                  <p className="mt-1 text-sm text-slate-500">{task.issueType} · {task.owner}</p>
                </div>
                <Badge variant={task.priority === "高" ? "danger" : "warning"}>{task.priority}</Badge>
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="待复审知识">
          <div className="space-y-3">
            {lifecycleItems.filter((item) => item.status !== "正常").slice(0, 4).map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-2xl border bg-white p-4">
                <div>
                  <p className="font-medium">{item.title}</p>
                  <p className="mt-1 text-sm text-slate-500">{item.validUntil} · {item.owner}</p>
                </div>
                <StatusBadge status={item.status} />
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
