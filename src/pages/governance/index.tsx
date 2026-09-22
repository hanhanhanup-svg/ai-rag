import { ArrowRight, FileText, ListChecks, Sparkles, Tags, Wand2 } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { DataTable, type TableColumn } from "@/components/common/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/store/useAppStore";

const issueGroups = [
  {
    name: "摘要缺失",
    count: 54,
    description: "影响搜索结果理解和问答引用效果",
    actions: ["AI 生成摘要", "创建任务", "查看知识"],
    icon: FileText,
    tone: "warning" as const
  },
  {
    name: "缺少问题变体",
    count: 38,
    description: "影响 FAQ 召回和用户自然问法匹配",
    actions: ["AI 生成问法", "创建任务", "查看知识"],
    icon: Sparkles,
    tone: "warning" as const
  },
  {
    name: "标签缺失",
    count: 12,
    description: "影响分类管理、检索过滤和知识地图分析",
    actions: ["AI 推荐标签", "创建任务"],
    icon: Tags,
    tone: "default" as const
  },
  {
    name: "来源不清晰",
    count: 8,
    description: "影响知识可信度和审核追溯",
    actions: ["补充来源", "创建任务"],
    icon: ListChecks,
    tone: "default" as const
  },
  {
    name: "质量分偏低",
    count: 28,
    description: "标题、摘要、来源、标签等多项信息不完整",
    actions: ["修复", "下架", "创建任务"],
    icon: Wand2,
    tone: "danger" as const
  }
];

const issueDetails = [
  {
    title: "员工手册适用范围",
    type: "摘要缺失",
    knowledgeBase: "员工制度知识库",
    score: 57,
    impact: "搜索结果难以快速判断适用对象",
    action: "AI 生成摘要"
  },
  {
    title: "一般违纪行为说明",
    type: "缺少问题变体",
    knowledgeBase: "员工制度知识库",
    score: 58,
    impact: "自然问法召回不足，影响员工问答",
    action: "AI 生成问法"
  },
  {
    title: "售前客户常见问题",
    type: "标签缺失",
    knowledgeBase: "售前知识库",
    score: 72,
    impact: "影响分类过滤和知识地图分析",
    action: "AI 推荐标签"
  },
  {
    title: "项目资料共享规范",
    type: "来源不清晰",
    knowledgeBase: "公司规章制度知识库",
    score: 66,
    impact: "审核追溯和可信引用不足",
    action: "补充来源"
  }
];

export default function GovernancePage() {
  const addToast = useAppStore((state) => state.addToast);

  const columns: TableColumn<(typeof issueDetails)[number]>[] = [
    { key: "title", title: "知识标题", render: (row) => <span className="font-medium text-slate-900">{row.title}</span> },
    { key: "type", title: "问题类型", render: (row) => <Badge variant={row.score < 60 ? "danger" : "warning"}>{row.type}</Badge> },
    { key: "kb", title: "所属知识库", render: (row) => row.knowledgeBase },
    { key: "score", title: "质量分", render: (row) => row.score },
    { key: "impact", title: "影响说明", render: (row) => <span className="text-slate-600">{row.impact}</span> },
    { key: "action", title: "推荐动作", render: (row) => row.action },
    {
      key: "op",
      title: "操作",
      render: (row) => (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => addToast({ title: `${row.action}已执行`, description: row.title, type: "success" })}>
            处理
          </Button>
          <Button size="sm" onClick={() => addToast({ title: "已创建治理任务", description: row.title, type: "success" })}>
            创建任务
          </Button>
        </div>
      )
    }
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="问题清单"
        description="集中查看知识体检发现的问题，并支持 AI 修复、人工处理或转为治理任务。"
        actions={
          <>
            <Button variant="outline" onClick={() => addToast({ title: "已为 54 条知识生成摘要", type: "success" })}>
              <Wand2 className="h-4 w-4" />
              一键生成摘要
            </Button>
            <Button onClick={() => addToast({ title: "已批量创建治理任务", type: "success" })}>
              <ArrowRight className="h-4 w-4" />
              批量创建任务
            </Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-5">
        {issueGroups.map((group) => (
          <div key={group.name} className="rounded-2xl border bg-white p-5 shadow-soft">
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                <group.icon className="h-5 w-5" />
              </div>
              <Badge variant={group.tone}>{group.count}</Badge>
            </div>
            <p className="mt-4 font-semibold text-slate-950">{group.name}</p>
            <p className="mt-2 min-h-[44px] text-sm leading-6 text-slate-500">{group.description}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {group.actions.map((action) => (
                <Button key={action} size="sm" variant="outline" onClick={() => addToast({ title: `${action}已模拟执行`, description: group.name, type: "success" })}>
                  {action}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <SectionCard title="问题明细" description="按知识条目查看影响说明和推荐动作，便于快速修复或转为任务。">
        <DataTable columns={columns} data={issueDetails} rowKey={(row) => row.title} />
      </SectionCard>
    </div>
  );
}
