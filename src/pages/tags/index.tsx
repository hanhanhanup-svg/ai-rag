import { useMemo, useState } from "react";
import { GitBranch, Merge, Plus, SearchCheck, ShieldCheck, Sparkles, Tags } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { MetricCard } from "@/components/common/MetricCard";
import { SectionCard } from "@/components/common/SectionCard";
import { DataTable, type TableColumn } from "@/components/common/DataTable";
import { ProgressBar } from "@/components/common/ProgressBar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/common/Tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { tagGroups, type PrecisionTagItem } from "@/data/mock/precisionGovernance";
import { useAppStore } from "@/store/useAppStore";

export default function TagsPage() {
  const [activeGroupId, setActiveGroupId] = useState(tagGroups[0].id);
  const addToast = useAppStore((state) => state.addToast);
  const activeGroup = useMemo(() => tagGroups.find((group) => group.id === activeGroupId) ?? tagGroups[0], [activeGroupId]);

  const tagColumns: TableColumn<PrecisionTagItem>[] = [
    { key: "name", title: "标签名称", render: (row) => <span className="font-medium text-slate-900">{row.name}</span> },
    { key: "usage", title: "使用频次", render: (row) => row.usage.toLocaleString("zh-CN") },
    { key: "related", title: "关联知识数", render: (row) => `${row.relatedKnowledge} 条` },
    { key: "relation", title: "治理关系", render: (row) => <Badge variant="outline">{row.relation}</Badge> },
    { key: "confidence", title: "纠偏置信度", render: (row) => <div className="w-32"><ProgressBar value={row.confidence} label="置信度" /></div> },
    {
      key: "op",
      title: "操作",
      render: (row) => (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => addToast({ title: "已打开关联知识", description: row.name })}>查看关联知识</Button>
          <Button size="sm" variant="outline" onClick={() => addToast({ title: "已提交标签纠偏", description: row.name, type: "success" })}>标签纠偏</Button>
        </div>
      )
    }
  ];

  const simulate = (title: string) => addToast({ title, description: activeGroup.name, type: "success" });

  return (
    <div className="space-y-6">
      <PageHeader
        title="标签体系管理"
        description="将标签升级为领域、场景、知识类型、权限和输出五类治理标签，支撑精准检索、可信问答和知识鉴权。"
        actions={
          <>
            <Button variant="outline" onClick={() => simulate("已进入标签合并工作台")}>
              <Merge className="h-4 w-4" />
              合并标签
            </Button>
            <Button variant="outline" onClick={() => simulate("已启动标签纠偏扫描")}>
              <Sparkles className="h-4 w-4" />
              标签纠偏
            </Button>
            <Button onClick={() => simulate("已打开新增标签面板")}>
              <Plus className="h-4 w-4" />
              新增标签
            </Button>
          </>
        }
      />

      <section className="rounded-3xl border bg-gradient-to-br from-white via-indigo-50/70 to-emerald-50/50 p-6 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <Badge variant="success">五类标签治理</Badge>
            <h2 className="mt-4 text-2xl font-semibold tracking-normal text-slate-950">用标签把问题、场景、权限和输出边界串起来</h2>
            <p className="mt-3 max-w-4xl text-sm leading-7 text-slate-600">
              用户提问后，系统先识别领域和场景标签，再用知识类型标签决定答案模板，通过权限标签校验可访问范围，最后用输出标签判断是否允许引用、下载、生成报告或生成标书。
            </p>
          </div>
          <div className="grid min-w-[360px] grid-cols-3 gap-3">
            <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
              <p className="text-2xl font-semibold text-indigo-600">36</p>
              <p className="mt-1 text-xs text-slate-500">核心治理标签</p>
            </div>
            <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
              <p className="text-2xl font-semibold text-emerald-600">52,720</p>
              <p className="mt-1 text-xs text-slate-500">累计参与匹配</p>
            </div>
            <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
              <p className="text-2xl font-semibold text-amber-600">96%</p>
              <p className="mt-1 text-xs text-slate-500">自动纠偏置信度</p>
            </div>
          </div>
        </div>
      </section>

      <Tabs value={activeGroupId} onValueChange={setActiveGroupId}>
        <TabsList>
          {tagGroups.map((group) => (
            <TabsTrigger key={group.id} value={group.id}>{group.name}</TabsTrigger>
          ))}
        </TabsList>

        {tagGroups.map((group) => (
          <TabsContent key={group.id} value={group.id} className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard title="标签数量" value={group.total} description={group.description} icon={<Tags className="h-5 w-5 text-indigo-500" />} />
              <MetricCard title="使用频次" value={group.frequency.toLocaleString("zh-CN")} description="参与检索、问答和权限判断的累计次数" icon={<SearchCheck className="h-5 w-5 text-emerald-500" />} />
              <MetricCard title="关联知识数" value={group.items.reduce((sum, item) => sum + item.relatedKnowledge, 0)} description="同一知识可关联多类标签" icon={<GitBranch className="h-5 w-5 text-amber-500" />} />
              <MetricCard title="治理关系" value={group.participation.length} description={group.participation.join(" / ")} icon={<ShieldCheck className="h-5 w-5 text-sky-500" />} />
            </div>

            <div className="grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
              <SectionCard title={`${group.name}与精准问答关系`} description="标签不仅用于分类，也参与问题理解、检索过滤、权限控制和输出控制。">
                <div className="space-y-3">
                  {group.participation.map((item) => (
                    <div key={item} className="flex items-center justify-between rounded-2xl border bg-slate-50 p-4">
                      <div className="flex items-center gap-3">
                        <div className="rounded-2xl bg-indigo-100 p-2 text-indigo-600">
                          <Sparkles className="h-4 w-4" />
                        </div>
                        <p className="font-medium text-slate-800">{item}</p>
                      </div>
                      <Badge variant="success">已启用</Badge>
                    </div>
                  ))}
                  <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4 text-sm leading-6 text-indigo-800">
                    例：问题“数据共享审批流程是什么？”会命中领域标签“数据治理 / 数据安全”、场景标签“流程咨询”、知识类型标签“制度类 / 流程类”，再根据权限标签和输出标签决定答案可见范围。
                  </div>
                </div>
              </SectionCard>

              <SectionCard
                title={`${group.name}明细`}
                description="展示每个标签的使用频次、关联知识数和在治理链路中的作用。"
                actions={
                  <>
                    <Button size="sm" variant="outline" onClick={() => simulate("已提交批量合并建议")}>合并标签</Button>
                    <Button size="sm" onClick={() => simulate("已新增标签草稿")}>新增标签</Button>
                  </>
                }
              >
                <DataTable columns={tagColumns} data={group.items} rowKey={(row) => row.id} />
              </SectionCard>
            </div>
          </TabsContent>
        ))}
      </Tabs>

      <SectionCard title="标签纠偏任务" description="模拟系统自动发现标签缺失、标签冲突和输出标签不完整的问题。">
        <div className="grid gap-3 md:grid-cols-3">
          {[
            ["领域标签缺失", "28 条知识需要补齐领域标签", "立即补齐"],
            ["权限标签冲突", "6 条知识同时标记内部和公开", "发起复核"],
            ["输出标签不完整", "17 条高价值知识缺少报告引用标签", "批量纠偏"]
          ].map(([title, desc, action]) => (
            <div key={title} className="rounded-2xl border bg-white p-5 shadow-sm">
              <Badge variant={title === "权限标签冲突" ? "warning" : "default"}>{title}</Badge>
              <p className="mt-3 text-sm leading-6 text-slate-600">{desc}</p>
              <Button className="mt-4" size="sm" variant="outline" onClick={() => simulate(`${action}已模拟执行`)}>
                {action}
              </Button>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
