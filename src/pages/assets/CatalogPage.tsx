import { useState } from "react";
import { Folder, FolderPlus, MoveRight, Tags } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { DataTable, type TableColumn } from "@/components/common/DataTable";
import { KnowledgeTypeBadge } from "@/components/common/KnowledgeTypeBadge";
import { SensitivityBadge } from "@/components/common/SensitivityBadge";
import { KnowledgeDetailDrawer } from "@/components/drawers/KnowledgeDetailDrawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { knowledgeItems } from "@/data/mock/knowledgeItems";
import { useAppStore } from "@/store/useAppStore";
import { useAuthStore } from "@/auth/authStore";
import { filterKnowledgeItemsByRole } from "@/lib/roleDataFilter";
import type { KnowledgeItem } from "@/types";

const tree = [
  { name: "测试知识库", children: ["员工制度", "考勤加班", "违纪处理", "沟通反馈"] },
  { name: "公司规章制度知识库", children: ["密级要求", "资料外发", "审批流程"] },
  { name: "营销部知识库", children: ["客户话术", "竞品分析"] }
];

export default function CatalogPage() {
  const [selected, setSelected] = useState<KnowledgeItem | null>(null);
  const addToast = useAppStore((state) => state.addToast);
  const currentUser = useAuthStore((state) => state.currentUser);
  const scopedKnowledgeItems = filterKnowledgeItemsByRole(currentUser, knowledgeItems);

  const columns: TableColumn<KnowledgeItem>[] = [
    { key: "title", title: "知识标题", render: (row) => <button className="font-medium text-slate-900 hover:text-indigo-600" onClick={() => setSelected(row)}>{row.title}</button> },
    { key: "type", title: "类型", render: (row) => <KnowledgeTypeBadge type={row.type} /> },
    { key: "tags", title: "标签", render: (row) => <div className="flex flex-wrap gap-1">{row.tags.slice(0, 2).map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}</div> },
    { key: "level", title: "密级", render: (row) => <SensitivityBadge level={row.sensitivity} /> },
    { key: "score", title: "质量分", render: (row) => row.qualityScore },
    { key: "op", title: "操作", render: (row) => <Button size="sm" variant="outline" onClick={() => setSelected(row)}>查看详情</Button> }
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="知识目录"
        description="按知识库和分类整理知识条目，支持移动知识、批量打标和调整密级。"
        actions={
          <>
            <Button variant="outline" onClick={() => addToast({ title: "已模拟批量设置标签", type: "success" })}><Tags className="h-4 w-4" />批量设置标签</Button>
            <Button variant="outline" onClick={() => addToast({ title: "已模拟批量调整密级", type: "success" })}>批量调整密级</Button>
            <Button onClick={() => addToast({ title: "分类创建成功", description: "新分类已加入目录树。", type: "success" })}><FolderPlus className="h-4 w-4" />新建分类</Button>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <SectionCard title="目录树" description="选择分类后查看右侧知识。">
          <div className="space-y-4">
            {tree.map((root) => (
              <div key={root.name}>
                <div className="flex items-center gap-2 rounded-2xl bg-indigo-50 px-3 py-2 font-medium text-indigo-700">
                  <Folder className="h-4 w-4" />
                  {root.name}
                </div>
                <div className="ml-4 mt-2 space-y-1 border-l pl-3">
                  {root.children.map((child) => (
                    <button key={child} className="block w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-slate-50">
                      {child}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard
          title="知识列表"
          description="点击条目打开统一知识详情抽屉。"
          actions={<Button size="sm" variant="outline" onClick={() => addToast({ title: "已模拟移动知识", type: "success" })}><MoveRight className="h-4 w-4" />移动知识</Button>}
        >
          <DataTable columns={columns} data={scopedKnowledgeItems.slice(0, 12)} rowKey={(row) => row.id} />
        </SectionCard>
      </div>
      <KnowledgeDetailDrawer open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)} item={selected} />
    </div>
  );
}
