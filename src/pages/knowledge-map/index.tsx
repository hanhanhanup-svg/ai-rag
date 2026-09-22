import { useMemo } from "react";
import ReactFlow, { Background, Controls, Edge, Node } from "reactflow";
import { ArrowRight, ArrowUpRight, CalendarClock, Grid2X2, Plus } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { MetricCard } from "@/components/common/MetricCard";
import { SectionCard } from "@/components/common/SectionCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/common/Tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { knowledgeItems } from "@/data/mock/knowledgeItems";
import { knowledgeMapLinks } from "@/data/mock/precisionGovernance";
import { KnowledgeTypeBadge } from "@/components/common/KnowledgeTypeBadge";

const types = ["competitor", "compliance", "contract", "entity", "faq", "policy", "regulation", "sop", "text_chunk", "合计"];
const rows = [
  "测试知识库",
  "王强的个人知识库",
  "李娜的个人知识库",
  "张伟的个人知识库",
  "行政知识库",
  "营销部知识库",
  "公司规章制度知识库",
  "日常运营新知知识库"
];

const nodes: Node[] = [
  { id: "handbook", position: { x: 260, y: 40 }, data: { label: "员工手册" }, style: { borderRadius: 16, border: "1px solid #c7d2fe", background: "#eef2ff", padding: 12 } },
  { id: "overtime", position: { x: 60, y: 190 }, data: { label: "加班行为准则" }, style: { borderRadius: 16, border: "1px solid #bbf7d0", background: "#ecfdf5", padding: 12 } },
  { id: "discipline", position: { x: 250, y: 230 }, data: { label: "违纪通知流程" }, style: { borderRadius: 16, border: "1px solid #fed7aa", background: "#fff7ed", padding: 12 } },
  { id: "feedback", position: { x: 470, y: 190 }, data: { label: "员工反馈沟通规范" }, style: { borderRadius: 16, border: "1px solid #bae6fd", background: "#f0f9ff", padding: 12 } },
  { id: "minor", position: { x: 290, y: 390 }, data: { label: "一般违纪行为" }, style: { borderRadius: 16, border: "1px solid #fecdd3", background: "#fff1f2", padding: 12 } }
];

const edges: Edge[] = [
  { id: "e1", source: "handbook", target: "overtime", label: "包含", animated: true },
  { id: "e2", source: "handbook", target: "discipline", label: "包含" },
  { id: "e3", source: "handbook", target: "feedback", label: "包含" },
  { id: "e4", source: "discipline", target: "minor", label: "引用" },
  { id: "e5", source: "feedback", target: "discipline", label: "关联" },
  { id: "e6", source: "overtime", target: "minor", label: "同源" }
];

export default function KnowledgeMapPage() {
  const approved = useMemo(() => knowledgeItems.filter((item) => item.approvedAt).slice(0, 8), []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="知识地图"
        description="从知识类型、关系、盲区和时效维度观察企业知识资产分布。"
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
          </>
        }
      />

      <SectionCard
        title="问题—标签—场景—知识—调用效果链路"
        description="把用户高频问题映射为标签、场景和知识依据，并持续观察命中率、满意度和累计调用。"
      >
        <div className="space-y-4">
          {knowledgeMapLinks.map((link) => (
            <div key={link.id} className="rounded-3xl border bg-gradient-to-br from-white to-indigo-50/50 p-5">
              <div className="grid gap-3 xl:grid-cols-[1.1fr_1fr_1fr_1.2fr_0.9fr]">
                <div className="rounded-2xl bg-white p-4 shadow-sm">
                  <Badge variant="default">高频问题</Badge>
                  <p className="mt-3 font-semibold text-slate-950">“{link.question}”</p>
                </div>
                <div className="rounded-2xl bg-white p-4 shadow-sm">
                  <Badge variant="secondary">匹配标签</Badge>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {link.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
                  </div>
                </div>
                <div className="rounded-2xl bg-white p-4 shadow-sm">
                  <Badge variant="warning">应用场景</Badge>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {link.scenarios.map((scene) => <Badge key={scene} variant="secondary">{scene}</Badge>)}
                  </div>
                </div>
                <div className="rounded-2xl bg-white p-4 shadow-sm">
                  <Badge variant="success">关联知识</Badge>
                  <div className="mt-3 space-y-2">
                    {link.knowledge.map((item) => (
                      <p key={item} className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">{item}</p>
                    ))}
                  </div>
                </div>
                <div className="rounded-2xl bg-white p-4 shadow-sm">
                  <Badge variant="success">调用效果</Badge>
                  <div className="mt-3 grid gap-2 text-sm">
                    <p>命中率 <span className="font-semibold text-emerald-600">{link.effect.hitRate}</span></p>
                    <p>满意度 <span className="font-semibold text-indigo-600">{link.effect.satisfaction}</span></p>
                    <p>累计调用 <span className="font-semibold text-slate-900">{link.effect.calls.toLocaleString("zh-CN")}</span> 次</p>
                  </div>
                </div>
              </div>
              <div className="mt-4 hidden items-center justify-center gap-3 text-indigo-500 xl:flex">
                {[1, 2, 3, 4].map((item) => (
                  <ArrowRight key={item} className="h-5 w-5" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <Tabs defaultValue="matrix">
        <TabsList>
          <TabsTrigger value="matrix">知识全景矩阵</TabsTrigger>
          <TabsTrigger value="graph">知识关系图谱</TabsTrigger>
          <TabsTrigger value="blind">知识盲区地图</TabsTrigger>
          <TabsTrigger value="heat">时效热力图</TabsTrigger>
          <TabsTrigger value="approved">已审批知识</TabsTrigger>
        </TabsList>

        <TabsContent value="matrix" className="space-y-6">
          <SectionCard title="知识库 × 知识类型矩阵" description="横向对比各知识库在不同知识类型上的沉淀程度。">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[940px] border-separate border-spacing-2 text-sm">
                <thead>
                  <tr>
                    <th className="rounded-xl bg-slate-100 px-3 py-3 text-left">知识库</th>
                    {types.map((type) => <th key={type} className="rounded-xl bg-slate-100 px-3 py-3 text-center">{type}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row}>
                      <td className="rounded-xl bg-white px-3 py-3 font-medium shadow-sm">{row}</td>
                      {types.map((type) => {
                        const value = row === "测试知识库" ? ({ faq: 38, sop: 13, text_chunk: 3, 合计: 54 } as Record<string, number>)[type] ?? 0 : 0;
                        return (
                          <td key={type} className="rounded-xl bg-white px-3 py-3 text-center shadow-sm">
                            <span className={value > 0 ? "font-semibold text-indigo-600" : "text-slate-300"}>{value}</span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
          <div className="grid gap-4 lg:grid-cols-2">
            <MetricCard title="知识盲区" value="69 项" description="多类型或多知识库仍未覆盖" icon={<Grid2X2 className="h-5 w-5 text-indigo-500" />} />
            <MetricCard title="质量薄弱区" value="0 项" description="当前矩阵未识别出低质量聚集区" icon={<ArrowUpRight className="h-5 w-5 text-emerald-500" />} />
          </div>
        </TabsContent>

        <TabsContent value="graph">
          <SectionCard title="知识关系图谱" description="展示员工手册相关知识之间的包含、关联、引用和同源关系。">
            <div className="h-[540px] overflow-hidden rounded-2xl border bg-slate-50">
              <ReactFlow nodes={nodes} edges={edges} fitView>
                <Background />
                <Controls />
              </ReactFlow>
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="blind">
          <SectionCard title="知识盲区地图" description="将没有覆盖的知识库和知识类型转成可执行补充项。">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 9 }, (_, index) => (
                <div key={index} className="rounded-2xl border bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <Badge variant="warning">盲区</Badge>
                    <Button size="sm" variant="outline"><Plus className="h-4 w-4" />补充</Button>
                  </div>
                  <p className="mt-3 font-medium">{rows[(index + 1) % rows.length]} · {types[index % 8]}</p>
                  <p className="mt-2 text-sm text-slate-500">建议补充可问答、可审核的业务知识条目。</p>
                </div>
              ))}
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="heat" className="space-y-5">
          <SectionCard title="时效热力图" description="按月份和类型观察最近更新活跃度。">
            <div className="grid gap-3 md:grid-cols-3">
              {["faq", "sop", "text_chunk"].map((type, index) => (
                <div key={type} className="rounded-2xl bg-slate-50 p-4">
                  <p className="font-semibold">{type}</p>
                  <div className="mt-4 grid grid-cols-6 gap-2">
                    {Array.from({ length: 12 }, (_, month) => (
                      <div key={month} className="h-10 rounded-lg" style={{ background: month > 8 ? ["#c7d2fe", "#bbf7d0", "#fde68a"][index] : "#e2e8f0" }} />
                    ))}
                  </div>
                  <p className="mt-3 text-sm text-slate-500">最近活跃类型：{type} {index === 0 ? 38 : index === 1 ? 13 : 3} 条</p>
                </div>
              ))}
            </div>
          </SectionCard>
          <SectionCard title="持续空白预警" description="识别长期停滞的知识类型，推动更新任务。">
            <div className="space-y-3">
              {["faq", "sop", "text_chunk"].map((type) => (
                <div key={type} className="flex items-center justify-between rounded-2xl border bg-white p-4">
                  <div className="flex items-center gap-3">
                    <CalendarClock className="h-5 w-5 text-amber-500" />
                    <span>{type} 已停滞 10 个月</span>
                  </div>
                  <Button size="sm" variant="outline">创建更新任务</Button>
                </div>
              ))}
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="approved" className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard title="本月审批通过" value="49条" />
            <MetricCard title="平均审批时长" value="47.8天" />
            <MetricCard title="一次通过率" value="100%" />
            <MetricCard title="高质量占比" value="0%" />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {approved.map((item) => (
              <div key={item.id} className="rounded-2xl border bg-white p-5 shadow-soft">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-950">{item.title}</p>
                    <p className="mt-2 text-sm text-slate-500">审批人：{item.reviewer} · 审批日期：{item.approvedAt}</p>
                  </div>
                  <KnowledgeTypeBadge type={item.type} />
                </div>
                <p className="mt-4 text-sm text-slate-500">质量分：{item.qualityScore}</p>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
