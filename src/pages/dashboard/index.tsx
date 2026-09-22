import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  CheckCircle2,
  Clock3,
  FileCheck2,
  Heart,
  KeyRound,
  Layers3,
  MessageSquareText,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  Target,
  UploadCloud
} from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { PageHeader } from "@/components/common/PageHeader";
import { MetricCard } from "@/components/common/MetricCard";
import { SectionCard } from "@/components/common/SectionCard";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { DataTable, type TableColumn } from "@/components/common/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { knowledgeBases } from "@/data/mock/knowledgeBases";
import { reviewTasks } from "@/data/mock/reviewTasks";
import { typeDistribution } from "@/data/mock/dashboard";
import { notifications } from "@/data/mock/workspace";
import {
  frequentQuestions,
  highValueKnowledgeList,
  knowledgeGapList,
  precisionDashboardMetrics
} from "@/data/mock/precisionGovernance";
import { quickEntryItems } from "@/routes/nav";
import { useAuthStore } from "@/auth/authStore";
import { canAccessPath } from "@/lib/permissions";
import { filterKnowledgeBasesByRole, getRoleDashboardStats } from "@/lib/roleDataFilter";

const precisionMetricIcons = [
  ShieldCheck,
  BadgeCheck,
  KeyRound,
  AlertTriangle,
  Clock3,
  SearchCheck,
  Target,
  Layers3
];

const precisionToneClasses = {
  normal: "border-indigo-100 bg-indigo-50/60 text-indigo-700",
  attention: "border-amber-100 bg-amber-50/70 text-amber-700",
  success: "border-emerald-100 bg-emerald-50/70 text-emerald-700",
  warning: "border-orange-100 bg-orange-50/70 text-orange-700",
  danger: "border-red-100 bg-red-50/70 text-red-700",
  muted: "border-slate-100 bg-slate-50 text-slate-600"
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const currentUser = useAuthStore((state) => state.currentUser);
  const stats = getRoleDashboardStats(currentUser);
  const roleKnowledgeBases = filterKnowledgeBasesByRole(currentUser, knowledgeBases);
  const visibleQuickEntries = quickEntryItems.filter((entry) => canAccessPath(currentUser, entry.path));
  const todoTasks = reviewTasks.slice(1, 5);
  const highValueColumns: TableColumn<(typeof highValueKnowledgeList)[number]>[] = [
    { key: "name", title: "知识名称", render: (row) => <span className="font-medium text-slate-900">{row.name}</span> },
    { key: "domain", title: "所属领域", render: (row) => <Badge variant="secondary">{row.domain}</Badge> },
    { key: "trust", title: "可信等级", render: (row) => <Badge variant={row.trustLevel === "S级" ? "success" : "default"}>{row.trustLevel}</Badge> },
    { key: "score", title: "质量评分", render: (row) => <span className="font-semibold text-indigo-600">{row.qualityScore}</span> },
    { key: "calls", title: "调用次数", render: (row) => row.calls.toLocaleString("zh-CN") }
  ];
  const frequentColumns: TableColumn<(typeof frequentQuestions)[number]>[] = [
    { key: "question", title: "问题", render: (row) => <span className="font-medium text-slate-900">{row.question}</span> },
    { key: "scenario", title: "匹配场景", render: (row) => <Badge variant="outline">{row.scenario}</Badge> },
    { key: "hit", title: "命中率", render: (row) => <span className="font-semibold text-emerald-600">{row.hitRate}</span> },
    { key: "related", title: "关联知识数", render: (row) => `${row.relatedCount} 条` }
  ];
  const gapColumns: TableColumn<(typeof knowledgeGapList)[number]>[] = [
    { key: "question", title: "缺口问题", render: (row) => <span className="font-medium text-slate-900">{row.question}</span> },
    { key: "domain", title: "所属领域", render: (row) => <Badge variant="warning">{row.domain}</Badge> },
    { key: "count", title: "出现次数", render: (row) => row.occurrences },
    { key: "dept", title: "建议补充责任部门", render: (row) => row.department }
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="我的知识工作空间"
        description="快速处理待办、搜索可信知识、查看最近动态，让知识沉淀和使用都更顺手。"
        actions={
          <>
            <Button variant="outline" onClick={() => navigate("/application/search")}>
              搜知识
            </Button>
            <Button onClick={() => navigate("/application/chat")}>
              <Sparkles className="h-4 w-4" />
              问 AI
            </Button>
          </>
        }
      />

      <SectionCard title="快速入口" description="把最常用的知识动作放在手边。">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibleQuickEntries.map((entry) => (
            <button
              key={entry.title}
              onClick={() => navigate(entry.path)}
              className="group rounded-3xl border bg-gradient-to-br from-white to-slate-50 p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-glow"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 transition group-hover:bg-indigo-600 group-hover:text-white">
                <entry.icon className="h-5 w-5" />
              </span>
              <p className="mt-4 font-semibold text-slate-950">{entry.title}</p>
              <p className="mt-1 text-sm text-slate-500">立即进入</p>
            </button>
          ))}
        </div>
      </SectionCard>

      <section className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-gradient-to-br from-indigo-500 via-violet-500 to-sky-400 p-8 text-white shadow-glow">
        <div className="absolute right-[-80px] top-[-80px] h-56 w-56 rounded-full bg-white/20 blur-3xl" />
        <div className="absolute bottom-[-110px] left-[45%] h-64 w-64 rounded-full bg-cyan-200/25 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-8">
          <div>
            <p className="text-sm text-white/75">X-RAG 知识工作台</p>
            <h2 className="mt-4 text-4xl font-semibold tracking-normal">欢迎回来，{currentUser?.name ?? "演示用户"}</h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/82">
              今日 2026年5月21日 · {currentUser?.businessDomain ?? "知识空间"}运行正常 · 已接入 {stats.connectedApps} 个业务应用。你有 {stats.pendingReview} 条知识待审核，平均质量分 {stats.averageQuality}。
            </p>
          </div>
          <div className="grid min-w-[360px] grid-cols-3 gap-3">
            {[
              ["待处理", String(stats.pendingReview)],
              ["知识总量", String(stats.knowledgeTotal)],
              ["健康度", String(stats.averageQuality)]
            ].map(([label, value]) => (
              <div key={label} className="rounded-3xl bg-white/15 px-5 py-4 backdrop-blur">
                <p className="text-3xl font-semibold">{value}</p>
                <p className="mt-1 text-xs text-white/72">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-5">
        <div className="rounded-3xl border border-indigo-100 bg-gradient-to-br from-white via-indigo-50/70 to-emerald-50/60 p-6 shadow-soft">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <Badge variant="success">知识精准治理驾驶舱</Badge>
              <h2 className="mt-4 text-2xl font-semibold tracking-normal text-slate-950">可信、精准、可控、可溯的知识运营总览</h2>
              <p className="mt-3 max-w-4xl text-sm leading-7 text-slate-600">
                平台围绕知识可信、分类精准、权限可控、调用可溯、持续优化，构建面向行业知识的全流程精准治理体系。
              </p>
            </div>
            <Button variant="outline" onClick={() => navigate("/governance/quality")}>
              查看质量模型
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {precisionDashboardMetrics.map((metric, index) => {
            const Icon = precisionMetricIcons[index] ?? ShieldCheck;

            return (
              <div key={metric.id} className="knowledge-card rounded-2xl border bg-white p-5 shadow-soft">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-slate-500">{metric.label}</p>
                    <p className="mt-3 text-3xl font-semibold tracking-normal text-slate-950">{metric.value}</p>
                  </div>
                  <span className={`rounded-2xl border p-3 ${precisionToneClasses[metric.tone]}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                </div>
                <p className="mt-3 min-h-[40px] text-sm leading-5 text-slate-500">{metric.description}</p>
                <Badge className="mt-4" variant={metric.tone === "danger" ? "danger" : metric.tone === "warning" || metric.tone === "attention" ? "warning" : metric.tone === "success" ? "success" : "default"}>
                  {metric.trend}
                </Badge>
              </div>
            );
          })}
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <SectionCard title="高价值知识 TOP10" description="按调用、可信等级和质量评分识别真正有用的知识。">
            <DataTable columns={highValueColumns} data={highValueKnowledgeList} rowKey={(row) => row.id} />
          </SectionCard>
          <SectionCard title="高频问题 TOP10" description="用于反推标签、场景和知识缺口。">
            <DataTable columns={frequentColumns} data={frequentQuestions} rowKey={(row) => row.id} />
          </SectionCard>
          <SectionCard title="知识缺口 TOP10" description="把问不到、答不准的问题转为补充任务。">
            <DataTable columns={gapColumns} data={knowledgeGapList} rowKey={(row) => row.id} />
          </SectionCard>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="知识总量" value={stats.knowledgeTotal} description={`${roleKnowledgeBases.length} 个可见知识库`} icon={<FileCheck2 className="h-5 w-5 text-amber-500" />} />
        <MetricCard title="待审核" value={stats.pendingReview} description="按当前身份数据范围统计" icon={<Sparkles className="h-5 w-5 text-indigo-500" />} />
        <MetricCard title="平均质量分" value={stats.averageQuality} description="质量分越高，搜索和问答越稳定" icon={<CheckCircle2 className="h-5 w-5 text-emerald-500" />} />
        <MetricCard title="API 调用/月" value={stats.apiCallsMonthly.toLocaleString("zh-CN")} description={`${stats.connectedApps} 个应用已接入`} icon={<ArrowUpRight className="h-5 w-5 text-indigo-500" />} />
      </div>

      <div className="grid gap-6">
        <SectionCard title="我的待办" description="优先处理超时审核、治理任务和即将到期知识。">
          <div className="space-y-3">
            {todoTasks.map((task) => (
              <div key={task.id} className="flex items-center justify-between gap-4 rounded-3xl border bg-white p-4 shadow-sm">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant={task.type === "FAQ" ? "default" : "success"}>{task.type}</Badge>
                    <StatusBadge status={task.sla} />
                  </div>
                  <p className="mt-2 truncate font-medium text-slate-950">{task.title}</p>
                  <p className="mt-1 text-xs text-slate-500">来自 {task.knowledgeBase} · 置信度 {Math.round(task.confidence * 100)}%</p>
                </div>
                <Button size="sm" onClick={() => navigate("/workspace/todos")}>处理</Button>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.8fr_0.8fr]">
        <SectionCard title="近期知识动态" description="上传、审核、质量扫描和应用调用的最新变化。">
          <div className="space-y-3">
            {notifications.slice(0, 5).map((notice) => (
              <div key={notice.id} className="flex gap-3 rounded-2xl bg-slate-50 p-3">
                <Clock3 className="mt-1 h-4 w-4 text-indigo-500" />
                <div>
                  <p className="text-sm font-medium text-slate-900">{notice.title}</p>
                  <p className="mt-1 text-xs text-slate-500">{notice.time} · {notice.type}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="知识健康度" description="当前知识类型与质量状态。">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={typeDistribution} dataKey="value" innerRadius={52} outerRadius={78} paddingAngle={4}>
                  {typeDistribution.map((item) => (
                    <Cell key={item.name} fill={item.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2">
            {typeDistribution.map((item) => (
              <div key={item.name} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                <span>{item.name}</span>
                <span className="font-medium">{item.value} · {item.percent}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="常用知识库" description="你最近常打开的知识空间。">
          <div className="space-y-3">
            {roleKnowledgeBases.slice(0, 4).map((kb) => (
              <button key={kb.id} onClick={() => navigate("/assets/knowledge-bases")} className="flex w-full items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 text-left transition hover:bg-indigo-50">
                <div>
                  <p className="font-medium text-slate-900">{kb.name}</p>
                  <p className="mt-1 text-xs text-slate-500">{kb.type} · {kb.owner}</p>
                </div>
                <Heart className="h-4 w-4 text-slate-400" />
              </button>
            ))}
          </div>
        </SectionCard>
      </div>

      <SectionCard title="即将到期知识" description="暂无需要今天处理的到期知识。">
        <EmptyState title="暂无即将到期知识" description="系统会在知识到期前提醒责任人复审，保持知识持续可信。" icon={CheckCircle2} actionLabel="查看复审下架" onAction={() => navigate("/governance/lifecycle")} />
      </SectionCard>
    </div>
  );
}
