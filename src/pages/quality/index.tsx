import { useState } from "react";
import { Award, Download, Gauge, ListChecks, RefreshCw, ShieldCheck, Star, Wand2 } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { SectionCard } from "@/components/common/SectionCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/common/Tabs";
import { DataTable, type TableColumn } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { ProgressBar } from "@/components/common/ProgressBar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { qualityTrend } from "@/data/mock/dashboard";
import { lowQualityItems, qualityConflicts, qualityIssues, qualitySummary } from "@/data/mock/quality";
import {
  knowledgeValueCategories,
  qualityRectificationTasks,
  qualityScoreList,
  qualityScoreWeights
} from "@/data/mock/precisionGovernance";
import { useAppStore } from "@/store/useAppStore";

export default function QualityPage() {
  const [chartMode, setChartMode] = useState("整体");
  const [valueCategoryId, setValueCategoryId] = useState(knowledgeValueCategories[0].id);
  const [scanned, setScanned] = useState(false);
  const addToast = useAppStore((state) => state.addToast);
  const activeValueCategory = knowledgeValueCategories.find((item) => item.id === valueCategoryId) ?? knowledgeValueCategories[0];

  const scan = () => {
    setScanned(true);
    addToast({ title: "知识体检完成，共覆盖 54 条知识", description: "发现摘要缺失 54 条、缺少问题变体 38 条。", type: "success" });
  };

  const lowColumns: TableColumn<(typeof lowQualityItems)[number]>[] = [
    { key: "title", title: "标题", render: (row) => <span className="font-medium text-slate-900">{row.title}</span> },
    { key: "score", title: "质量分", render: (row) => row.score },
    {
      key: "op",
      title: "操作",
      render: () => (
        <div className="flex gap-2">
          <Button size="sm" variant="outline">修复</Button>
          <Button size="sm" variant="outline">下架</Button>
        </div>
      )
    }
  ];
  const scoreColumns: TableColumn<(typeof qualityScoreList)[number]>[] = [
    { key: "name", title: "知识名称", render: (row) => <span className="font-medium text-slate-900">{row.name}</span>, className: "min-w-[180px]" },
    { key: "authority", title: "来源权威性", render: (row) => row.authority },
    { key: "completeness", title: "内容完整性", render: (row) => row.completeness },
    { key: "timeliness", title: "时效有效性", render: (row) => row.timeliness },
    { key: "consistency", title: "准确一致性", render: (row) => row.consistency },
    { key: "relevance", title: "业务相关性", render: (row) => row.relevance },
    { key: "feedback", title: "用户反馈", render: (row) => row.feedback },
    { key: "conflict", title: "冲突风险", render: (row) => row.conflictRisk },
    { key: "total", title: "综合评分", render: (row) => <span className="font-semibold text-indigo-600">{row.total}</span> },
    {
      key: "level",
      title: "质量等级",
      render: (row) => (
        <Badge variant={row.level === "S级" ? "success" : row.level === "A级" ? "default" : row.level === "D级" ? "danger" : "warning"}>
          {row.level}
        </Badge>
      )
    },
    { key: "suggestion", title: "整改建议", render: (row) => row.suggestion, className: "min-w-[180px]" }
  ];
  const taskColumns: TableColumn<(typeof qualityRectificationTasks)[number]>[] = [
    { key: "title", title: "整改任务", render: (row) => <span className="font-medium text-slate-900">{row.title}</span> },
    { key: "owner", title: "责任部门", render: (row) => row.owner },
    { key: "priority", title: "优先级", render: (row) => <Badge variant={row.priority === "高" ? "danger" : "warning"}>{row.priority}</Badge> },
    { key: "due", title: "截止时间", render: (row) => row.dueAt },
    { key: "status", title: "状态", render: (row) => <StatusBadge status={row.status} /> }
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="知识体检"
        description="通过自动体检了解知识健康度、质量分布、主要问题和修复建议。"
        actions={
          <>
            <div className="w-44">
              <Select defaultValue="全部知识库">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="全部知识库">全部知识库</SelectItem>
                  <SelectItem value="测试知识库">测试知识库</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-36">
              <Select defaultValue="近30天">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="近30天">近30天</SelectItem>
                  <SelectItem value="近90天">近90天</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline"><Download className="h-4 w-4" />导出体检报告</Button>
            <Button onClick={scan}><RefreshCw className="h-4 w-4" />开始体检</Button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="知识健康度" value={scanned ? qualitySummary.average : qualitySummary.average} hint="整体待提升" tone="attention" />
        <StatCard label="待修复知识" value={qualitySummary.issues} hint="摘要、问题变体、标签等问题" tone="warning" />
        <StatCard label="高风险知识" value={qualitySummary.low} hint="低于 60 分或影响问答准确性" tone="danger" />
        <StatCard label="本月已修复" value={18} hint="治理后质量提升的知识" tone="success" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <SectionCard title="本次体检结论" description="用业务语言解释当前知识健康状态。">
          <div className="rounded-3xl bg-gradient-to-br from-indigo-50 via-white to-emerald-50 p-5">
            <p className="text-sm leading-7 text-slate-700">
              本次体检共覆盖 54 条知识，整体健康度 61.5 分，主要问题集中在摘要缺失、问题变体不足和部分知识重复。建议优先修复 28 条高风险知识，并对长期未更新知识发起复审。
            </p>
          </div>
        </SectionCard>
        <SectionCard title="推荐治理动作" description="优先处理对搜索、问答和可信引用影响更大的问题。">
          <div className="grid gap-3 md:grid-cols-2">
            {[
              ["为 54 条知识补充摘要", "去处理"],
              ["为 38 条 FAQ 生成问题变体", "批量修复"],
              ["处理 4 组疑似重复知识", "创建任务"],
              ["复审 6 条即将到期知识", "去处理"]
            ].map(([text, action]) => (
              <div key={text} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 p-4">
                <p className="text-sm font-medium text-slate-700">{text}</p>
                <Button size="sm" variant="outline">{action}</Button>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <SectionCard title="知识质量评分模型" description="按来源权威性、完整性、时效、准确一致、业务相关、用户反馈和冲突风险计算综合分。">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-7">
          {qualityScoreWeights.map((item) => (
            <div key={item.name} className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-slate-950">{item.name}</p>
                <Badge variant={item.weight >= 20 ? "success" : "outline"}>{item.weight}%</Badge>
              </div>
              <p className="mt-3 min-h-[48px] text-xs leading-5 text-slate-500">{item.description}</p>
              <div className="mt-3">
                <ProgressBar value={item.weight} label="权重" />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-5">
          {[
            ["S级", "90-100", "权威知识，优先召回", "success"],
            ["A级", "80-89", "高质量知识，可用于正式问答", "default"],
            ["B级", "70-79", "可用知识，可辅助回答", "outline"],
            ["C级", "60-69", "待优化知识，低优先级调用", "warning"],
            ["D级", "60以下", "风险知识，不参与正式问答", "danger"]
          ].map(([level, range, desc, variant]) => (
            <div key={level} className="rounded-2xl bg-slate-50 p-4">
              <Badge variant={variant as "default" | "secondary" | "success" | "warning" | "danger" | "outline"}>{level}</Badge>
              <p className="mt-3 text-lg font-semibold text-slate-950">{range}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{desc}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <SectionCard title="示例知识评分" description="每条知识按模型拆解分项，决定正式问答中的召回优先级。">
          <DataTable columns={scoreColumns} data={qualityScoreList} rowKey={(row) => row.id} />
        </SectionCard>
        <div className="space-y-6">
          <SectionCard title="风险知识列表" description="C级和D级知识需要降权、下架或重新审核。">
            <div className="space-y-3">
              {qualityScoreList.filter((item) => item.level === "C级" || item.level === "D级").map((item) => (
                <div key={item.id} className="rounded-2xl border bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-slate-900">{item.name}</p>
                    <Badge variant={item.level === "D级" ? "danger" : "warning"}>{item.level}</Badge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-500">{item.suggestion}</p>
                  <Button className="mt-3" size="sm" variant="outline" onClick={() => addToast({ title: "已创建风险整改任务", description: item.name, type: "success" })}>创建整改任务</Button>
                </div>
              ))}
            </div>
          </SectionCard>
          <SectionCard title="质量整改任务" description="从评分模型自动转化为责任明确的整改动作。">
            <DataTable columns={taskColumns} data={qualityRectificationTasks} rowKey={(row) => row.id} />
          </SectionCard>
        </div>
      </div>

      <SectionCard title="高价值知识发现" description="通过检索、问答、报告引用、点赞、纠错、专家推荐、场景覆盖、质量和可信等级识别真正有用的知识。">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {knowledgeValueCategories.map((category) => (
            <button
              key={category.id}
              onClick={() => setValueCategoryId(category.id)}
              className={`rounded-2xl border bg-white p-5 text-left shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50/40 ${
                valueCategoryId === category.id ? "border-indigo-300 bg-indigo-50" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-950">{category.name}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{category.description}</p>
                </div>
                <Badge variant={category.tone === "danger" ? "danger" : category.tone === "success" ? "success" : category.tone === "muted" ? "secondary" : "default"}>{category.count}</Badge>
              </div>
              <p className="mt-4 text-sm font-medium text-indigo-700">{category.action}</p>
            </button>
          ))}
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {activeValueCategory.items.map((item) => (
            <div key={item.name} className="rounded-2xl border bg-slate-50 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-950">{item.name}</p>
                  <p className="mt-1 text-sm text-slate-500">{item.domain} · {item.scenarioCoverage} · 最近更新 {item.updatedAt}</p>
                </div>
                <div className="flex gap-2">
                  <Badge variant={item.trustLevel === "S级" ? "success" : "default"}>{item.trustLevel}</Badge>
                  <Badge variant="outline">质量 {item.qualityScore}</Badge>
                </div>
              </div>
              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                <p className="rounded-xl bg-white px-3 py-2">检索 {item.searchCount}</p>
                <p className="rounded-xl bg-white px-3 py-2">问答 {item.qaCalls}</p>
                <p className="rounded-xl bg-white px-3 py-2">报告引用 {item.reportQuotes}</p>
                <p className="rounded-xl bg-white px-3 py-2">点赞 {item.likes}</p>
                <p className="rounded-xl bg-white px-3 py-2">纠错 {item.corrections}</p>
                <p className="rounded-xl bg-white px-3 py-2">专家推荐 {item.expertRecommends}</p>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <Badge variant="secondary">推荐动作：{item.action}</Badge>
                <Button size="sm" variant="outline" onClick={() => addToast({ title: `${item.action}已模拟执行`, description: item.name, type: "success" })}>执行动作</Button>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <SectionCard title="健康度趋势" description="支持按整体、类型和知识库切换观察知识健康变化。">
          <Tabs value={chartMode} onValueChange={setChartMode}>
            <TabsList>
              <TabsTrigger value="整体">整体</TabsTrigger>
              <TabsTrigger value="按类型">按类型</TabsTrigger>
              <TabsTrigger value="按知识库">按知识库</TabsTrigger>
            </TabsList>
            <TabsContent value={chartMode}>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={qualityTrend}>
                    <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 12 }} minTickGap={18} />
                    <YAxis hide domain={[50, 80]} />
                    <Tooltip />
                    <Line type="monotone" dataKey={chartMode === "按类型" ? "faq" : "score"} stroke="#6366f1" strokeWidth={3} dot={false} />
                    {chartMode === "按类型" && <Line type="monotone" dataKey="sop" stroke="#10b981" strokeWidth={3} dot={false} />}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </TabsContent>
          </Tabs>
        </SectionCard>

        <SectionCard title="各知识库质量对比" description="当前有质量数据的知识库。">
          <div className="rounded-2xl bg-slate-50 p-5">
            <div className="flex items-center justify-between">
              <p className="font-medium">测试知识库</p>
              <p className="text-2xl font-semibold text-indigo-600">61.5</p>
            </div>
            <div className="mt-4 h-3 rounded-full bg-slate-200">
              <div className="h-3 rounded-full bg-indigo-500" style={{ width: "61.5%" }} />
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="主要问题分布" description="按问题分组推动 AI 修复、人工处理或转为治理任务。">
        <div className="grid gap-4 xl:grid-cols-2">
          {qualityIssues.slice(0, 2).map((issue) => (
            <div key={issue.name} className="rounded-2xl border bg-white p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{issue.name}</p>
                  <p className="mt-1 text-sm text-slate-500">{issue.count} 条待处理</p>
                </div>
                <Badge variant="warning">{issue.count}</Badge>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm"><Wand2 className="h-4 w-4" />AI 批量生成</Button>
                <Button size="sm" variant="outline">批量延期</Button>
                <Button size="sm" variant="outline">批量下架</Button>
                <Button size="sm" variant="outline">修复</Button>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
        <SectionCard title="高风险知识列表" description="优先修复影响搜索理解和问答准确性的知识。">
          <DataTable columns={lowColumns} data={lowQualityItems} rowKey={(row) => row.title} />
        </SectionCard>

        <SectionCard title="冲突合并预览" description="识别语义相近但结论可能冲突的条目。">
          <div className="grid gap-3">
            {qualityConflicts.map((conflict) => (
              <div key={conflict.a} className="rounded-2xl border bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{conflict.a}</p>
                    <p className="mt-1 text-sm text-slate-500">对比：{conflict.b}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="warning">相似度 {conflict.similarity}</Badge>
                    <StatusBadge status={conflict.status} tone="normal" />
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {["保留A", "保留B", "合并条目", "两者都正确"].map((op) => <Button key={op} size="sm" variant="outline">{op}</Button>)}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
