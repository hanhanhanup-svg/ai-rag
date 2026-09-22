import { useMemo, useState } from "react";
import ReactFlow, { Background, Controls, Edge, Node } from "reactflow";
import { Copy, Play, Plus, Save, Shuffle, Timer } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { SearchInput } from "@/components/common/SearchInput";
import { SectionCard } from "@/components/common/SectionCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/common/Tabs";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { skills } from "@/data/mock/skills";
import type { SkillItem } from "@/types";
import { useAppStore } from "@/store/useAppStore";

export default function SkillsPage() {
  const [selectedId, setSelectedId] = useState("deep-pdf-extraction");
  const [selectedStep, setSelectedStep] = useState("PDF解析");
  const [open, setOpen] = useState(false);
  const selected = skills.find((skill) => skill.id === selectedId) ?? skills[0];
  const addToast = useAppStore((state) => state.addToast);

  const flow = useMemo(() => {
    const nodes: Node[] = selected.pipeline.map((step, index) => ({
      id: step,
      position: { x: index * 190, y: 120 },
      data: { label: step },
      style: {
        borderRadius: 16,
        padding: 12,
        border: step === selectedStep ? "2px solid #6366f1" : "1px solid #cbd5e1",
        background: step === selectedStep ? "#eef2ff" : "#ffffff"
      }
    }));
    nodes.push({
      id: "添加步骤",
      position: { x: selected.pipeline.length * 190, y: 120 },
      data: { label: "添加步骤" },
      style: { borderRadius: 16, padding: 12, border: "1px dashed #94a3b8", background: "#f8fafc" }
    });
    const edges: Edge[] = selected.pipeline.slice(0, -1).map((step, index) => ({
      id: `${step}-${selected.pipeline[index + 1]}`,
      source: step,
      target: selected.pipeline[index + 1],
      animated: true
    }));
    edges.push({ id: "last-add", source: selected.pipeline[selected.pipeline.length - 1], target: "添加步骤", animated: true });
    return { nodes, edges };
  }, [selected, selectedStep]);

  const grouped = {
    文档解析: skills.filter((skill) => skill.category === "文档解析"),
    专项能力: skills.filter((skill) => skill.category === "专项能力")
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="抽取技能管理"
        description="配置 AI 抽取流水线，管理各类文档解析与知识提取技能，支持可视化编排工具链。"
        actions={
          <>
            <Button variant="outline"><Timer className="h-4 w-4" />运行记录</Button>
            <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />新建技能</Button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="已配置技能" value="10" hint="较上月 +2" tone="normal" />
        <StatCard label="生产运行中" value="9" hint="可用率 99.2%" tone="success" />
        <StatCard label="本月总调用" value="1,284" hint="+18%" tone="normal" />
        <StatCard label="平均处理时长" value="3.2s" hint="较上周 -0.4s" tone="success" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <SectionCard title="技能库" description="按类型管理可复用抽取流水线。">
          <SearchInput placeholder="搜索技能" />
          <div className="mt-5 space-y-5">
            {(Object.keys(grouped) as Array<keyof typeof grouped>).map((group) => (
              <div key={group}>
                <p className="text-sm font-semibold text-slate-500">{group}</p>
                <div className="mt-2 space-y-2">
                  {grouped[group].map((skill: SkillItem) => (
                    <button
                      key={skill.id}
                      onClick={() => {
                        setSelectedId(skill.id);
                        setSelectedStep(skill.pipeline[0]);
                      }}
                      className={`w-full rounded-2xl border p-4 text-left transition ${selectedId === skill.id ? "border-indigo-200 bg-indigo-50" : "bg-white hover:bg-slate-50"}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{skill.name}</span>
                        <StatusBadge status={skill.status} />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title={selected.name} description={`ID：${selected.id} · ${selected.description}`}>
          <div className="mb-5 flex flex-wrap gap-2">
            <Badge variant="secondary">通用</Badge>
            <Badge variant="outline">{selected.version}</Badge>
            <Badge variant="outline">{selected.calls}次</Badge>
            <Badge variant="outline">均{selected.latency}</Badge>
            <Badge variant="outline">{selected.successRate}</Badge>
            <StatusBadge status={selected.status === "运行中" ? "生产运行" : selected.status} tone={selected.status === "运行中" ? "success" : "muted"} />
          </div>

          <Tabs defaultValue="pipeline">
            <TabsList>
              <TabsTrigger value="pipeline">流水线配置</TabsTrigger>
              <TabsTrigger value="params">参数设置</TabsTrigger>
              <TabsTrigger value="test">测试 & 预览</TabsTrigger>
              <TabsTrigger value="stats">调用统计</TabsTrigger>
            </TabsList>

            <TabsContent value="pipeline" className="space-y-5">
              <div className="h-[340px] overflow-hidden rounded-2xl border bg-slate-50">
                <ReactFlow nodes={flow.nodes} edges={flow.edges} fitView onNodeClick={(_, node) => setSelectedStep(String(node.id))}>
                  <Background />
                  <Controls />
                </ReactFlow>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => addToast({ title: "测试已启动", description: selected.name })}><Play className="h-4 w-4" />测试</Button>
                <Button size="sm" variant="outline"><Copy className="h-4 w-4" />复制</Button>
                <Button size="sm" variant="outline"><Shuffle className="h-4 w-4" />调整顺序</Button>
                <Button size="sm" variant="outline" onClick={() => addToast({ title: "技能配置已保存", type: "success" })}><Save className="h-4 w-4" />保存</Button>
                <Button size="sm" variant="outline"><Plus className="h-4 w-4" />添加步骤</Button>
              </div>
              <SectionCard title="步骤配置" description="点击流水线中的步骤后，可查看并调整该步骤配置。">
                <div className="grid gap-4 md:grid-cols-2">
                  <p><span className="text-slate-500">工具名称：</span>{selectedStep}</p>
                  <p><span className="text-slate-500">输入：</span>上游步骤输出</p>
                  <p><span className="text-slate-500">输出：</span>标准化文本或结构化对象</p>
                  <p><span className="text-slate-500">参数：</span>保留原文依据、中文输出</p>
                  <p><span className="text-slate-500">失败策略：</span>重试 2 次后进入人工确认</p>
                  <p><span className="text-slate-500">超时时间：</span>30s</p>
                  <p><span className="text-slate-500">是否启用：</span>启用</p>
                </div>
              </SectionCard>
            </TabsContent>

            <TabsContent value="params">
              <SectionCard>
                <div className="grid gap-4 md:grid-cols-2">
                  <Input placeholder="切片长度：800" />
                  <Input placeholder="重叠长度：120" />
                  <Input placeholder="置信度阈值：0.75" />
                  <Input placeholder="最大重试次数：2" />
                </div>
              </SectionCard>
            </TabsContent>
            <TabsContent value="test">
              <SectionCard title="测试 & 预览" description="上传样例文件后，预览抽取条目和原文依据。">
                <div className="rounded-2xl border border-dashed bg-slate-50 p-10 text-center text-slate-500">拖入样例文件进行测试</div>
              </SectionCard>
            </TabsContent>
            <TabsContent value="stats">
              <SectionCard title="调用统计" description="本月调用趋势与成功率表现。">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-2xl bg-indigo-50 p-5"><p className="text-sm text-slate-500">调用次数</p><p className="mt-2 text-2xl font-semibold">{selected.calls}</p></div>
                  <div className="rounded-2xl bg-emerald-50 p-5"><p className="text-sm text-slate-500">成功率</p><p className="mt-2 text-2xl font-semibold">{selected.successRate}</p></div>
                  <div className="rounded-2xl bg-amber-50 p-5"><p className="text-sm text-slate-500">平均耗时</p><p className="mt-2 text-2xl font-semibold">{selected.latency}</p></div>
                </div>
              </SectionCard>
            </TabsContent>
          </Tabs>
        </SectionCard>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建技能</DialogTitle>
            <DialogDescription>选择初始模板后，可继续在流水线配置中添加工具步骤。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <label className="space-y-2 text-sm font-medium"><span>技能名称</span><Input placeholder="例如：制度 FAQ 抽取" /></label>
            <label className="space-y-2 text-sm font-medium"><span>技能分类</span><Input placeholder="专项能力" /></label>
            <label className="space-y-2 text-sm font-medium"><span>适用文件类型</span><Input placeholder="PDF, Word" /></label>
            <label className="space-y-2 text-sm font-medium"><span>描述</span><Textarea placeholder="描述适合处理的文档和输出知识类型" /></label>
            <label className="space-y-2 text-sm font-medium">
              <span>初始模板</span>
              <Select defaultValue="通用知识切片">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["通用知识切片", "PDF 深度解析", "员工手册 FAQ 抽取"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={() => {
              setOpen(false);
              addToast({ title: "抽取技能已创建", description: "已保存为草稿，可继续编排工具链。", type: "success" });
            }}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
