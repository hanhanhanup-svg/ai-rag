import { GitBranch, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { DataTable, type TableColumn } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { knowledgeVersions } from "@/data/mock/workspace";
import { useAppStore } from "@/store/useAppStore";
import type { KnowledgeVersion } from "@/types";

export default function VersionsPage() {
  const addToast = useAppStore((state) => state.addToast);
  const columns: TableColumn<KnowledgeVersion>[] = [
    { key: "title", title: "知识标题", render: (row) => <span className="font-medium text-slate-900">{row.title}</span> },
    { key: "version", title: "当前版本", render: (row) => row.version },
    { key: "editor", title: "修改人", render: (row) => row.editor },
    { key: "time", title: "修改时间", render: (row) => row.editedAt },
    { key: "note", title: "变更说明", render: (row) => row.changeNote },
    { key: "status", title: "状态", render: (row) => <StatusBadge status={row.status} tone={row.status === "当前版本" ? "success" : row.status === "待发布" ? "warning" : "muted"} /> },
    {
      key: "op",
      title: "操作",
      render: (row) => (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => addToast({ title: "已打开差异对比", description: row.title })}><GitBranch className="h-4 w-4" />查看差异</Button>
          <Button size="sm" variant="outline" onClick={() => addToast({ title: "已模拟回滚版本", description: row.version, type: "success" })}><RotateCcw className="h-4 w-4" />回滚</Button>
          <Button size="sm" onClick={() => addToast({ title: "已设为当前版本", description: row.title, type: "success" })}>设为当前版本</Button>
        </div>
      )
    }
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="版本记录" description="跟踪知识条目的每次修改，支持查看差异、回滚和设为当前版本。" />
      <SectionCard title="版本变化列表" description="知识被修改后会保留版本记录，便于追溯和恢复。">
        <DataTable columns={columns} data={knowledgeVersions} rowKey={(row) => row.id} />
      </SectionCard>
    </div>
  );
}
