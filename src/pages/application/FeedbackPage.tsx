import { LifeBuoy } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { DataTable, type TableColumn } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { userFeedback } from "@/data/mock/workspace";
import { useAppStore } from "@/store/useAppStore";
import type { UserFeedback } from "@/types";

export default function FeedbackPage() {
  const addToast = useAppStore((state) => state.addToast);
  const columns: TableColumn<UserFeedback>[] = [
    { key: "content", title: "反馈内容", render: (row) => <span className="font-medium text-slate-900">{row.content}</span> },
    { key: "question", title: "来源问题", render: (row) => row.question },
    { key: "user", title: "用户", render: (row) => row.user },
    { key: "knowledge", title: "关联知识", render: (row) => row.relatedKnowledge },
    { key: "type", title: "反馈类型", render: (row) => <Badge variant="warning">{row.type}</Badge> },
    { key: "status", title: "状态", render: (row) => <StatusBadge status={row.status} /> },
    { key: "op", title: "操作", render: (row) => <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => addToast({ title: "反馈已标记处理中", description: row.content, type: "success" })}>处理</Button><Button size="sm" onClick={() => addToast({ title: "已加入治理任务", description: row.relatedKnowledge, type: "success" })}>转治理任务</Button></div> }
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="用户反馈" description="把答案不准、找不到、知识过期和权限问题沉淀为可处理的改进闭环。" />
      {userFeedback.length ? (
        <SectionCard title="反馈列表" description="处理后可转入治理任务，推动知识持续改进。">
          <DataTable columns={columns} data={userFeedback} rowKey={(row) => row.id} />
        </SectionCard>
      ) : (
        <EmptyState title="暂无反馈" description="去体验智能问答后，可以对答案提交反馈。" icon={LifeBuoy} actionLabel="去体验智能问答" />
      )}
    </div>
  );
}
