import { useState } from "react";
import { Download, FileJson } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { DataTable, type TableColumn } from "@/components/common/DataTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/common/Tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { outputProfiles, outputRules, exportHistory } from "@/data/mock/outputRules";
import type { OutputRule } from "@/types";

export default function OutputAdapterPage() {
  const [selectedRuleId, setSelectedRuleId] = useState("entity-faq");
  const selectedRule = outputRules.find((rule) => rule.id === selectedRuleId) ?? outputRules[0];
  const groups = Array.from(new Set(outputRules.map((rule) => rule.group)));

  const historyColumns: TableColumn<(typeof exportHistory)[number]>[] = [
    { key: "time", title: "导出时间", render: (row) => row.time },
    { key: "user", title: "导出人", render: (row) => row.user },
    { key: "scope", title: "知识范围", render: (row) => row.scope },
    { key: "format", title: "输出格式", render: (row) => row.format },
    { key: "count", title: "数量", render: (row) => row.count },
    { key: "status", title: "状态", render: (row) => <Badge variant="success">{row.status}</Badge> },
    { key: "download", title: "下载", render: () => <Button size="sm" variant="outline"><Download className="h-4 w-4" />下载</Button> }
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="知识输出适配" description="管理 Output Profile、转换规则、格式预览与导出历史。" />

      <Tabs defaultValue="profiles">
        <TabsList>
          <TabsTrigger value="profiles">Output Profiles</TabsTrigger>
          <TabsTrigger value="rules">转换规则配置</TabsTrigger>
          <TabsTrigger value="preview">格式预览</TabsTrigger>
          <TabsTrigger value="history">导出历史</TabsTrigger>
        </TabsList>

        <TabsContent value="profiles">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {outputProfiles.map((profile) => (
              <SectionCard key={profile} title={profile}>
                <div className="rounded-2xl bg-indigo-50 p-4 text-indigo-600">
                  <FileJson className="h-7 w-7" />
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-500">定义字段、密级、标签和下游消费格式。</p>
                <Button className="mt-5 w-full" variant="outline">配置</Button>
              </SectionCard>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="rules">
          <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
            <SectionCard title="模板库" description="按业务类型选择转换模板。">
              <div className="space-y-5">
                {groups.map((group) => (
                  <div key={group}>
                    <p className="mb-2 text-sm font-semibold text-slate-500">{group}</p>
                    <div className="space-y-2">
                      {outputRules.filter((rule) => rule.group === group).map((rule: OutputRule) => (
                        <button
                          key={rule.id}
                          onClick={() => setSelectedRuleId(rule.id)}
                          className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${selectedRuleId === rule.id ? "bg-indigo-50 font-medium text-indigo-700" : "hover:bg-slate-50"}`}
                        >
                          {rule.name} <span className="text-slate-400">，{rule.source}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard title={selectedRule.name} description="右侧展示转换逻辑、输入示例、输出示例、模板类型和规则编码。">
              <div className="grid gap-5">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-sm font-semibold">转换逻辑</p>
                  <p className="mt-2 leading-7 text-slate-600">{selectedRule.logic}</p>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl border bg-white p-4">
                    <p className="text-sm font-semibold">输入示例</p>
                    <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-950 p-4 text-sm text-slate-100">{selectedRule.input}</pre>
                  </div>
                  <div className="rounded-2xl border bg-white p-4">
                    <p className="text-sm font-semibold">输出示例</p>
                    <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-950 p-4 text-sm text-slate-100">{selectedRule.output}</pre>
                  </div>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl bg-indigo-50 p-4"><p className="text-sm text-slate-500">模板类型</p><p className="mt-1 font-semibold">Jinja2 模板</p></div>
                  <div className="rounded-2xl bg-emerald-50 p-4"><p className="text-sm text-slate-500">规则编码</p><p className="mt-1 font-mono text-sm">{selectedRule.code}</p></div>
                </div>
              </div>
            </SectionCard>
          </div>
        </TabsContent>

        <TabsContent value="preview">
          <SectionCard title="格式预览" description="选择输出配置后，可预览下游拿到的最终知识格式。">
            <div className="rounded-2xl bg-slate-950 p-5 text-sm text-slate-100">
              <pre>{`{
  "question": "X-RAG 是什么？",
  "answer": "X-RAG 属于产品类别，知识中台系统。",
  "type": "FAQ",
  "sensitivity": "L1"
}`}</pre>
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="history">
          <SectionCard title="导出历史" description="记录知识输出的范围、格式和下载状态。">
            <DataTable columns={historyColumns} data={exportHistory} rowKey={(row) => row.time} />
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}
