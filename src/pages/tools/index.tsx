import { useMemo, useState } from "react";
import { ArrowRight, Workflow } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/common/PageHeader";
import { SearchInput } from "@/components/common/SearchInput";
import { SectionCard } from "@/components/common/SectionCard";
import { DetailDrawer } from "@/components/drawers/DetailDrawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { tools } from "@/data/mock/tools";
import type { ToolItem } from "@/types";
import { formatNumber } from "@/lib/utils";

const categories = [
  { name: "全部工具", count: 23 },
  { name: "解析", count: 7 },
  { name: "清洗", count: 4 },
  { name: "切分", count: 3 },
  { name: "抽取", count: 6 },
  { name: "知识构建", count: 3 }
];

export default function ToolsPage() {
  const navigate = useNavigate();
  const [category, setCategory] = useState("全部工具");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ToolItem | null>(null);

  const filtered = useMemo(
    () =>
      tools.filter((tool) => {
        const byCategory = category === "全部工具" || tool.category === category;
        const byQuery = [tool.name, tool.description, tool.toolId].join(" ").toLowerCase().includes(query.toLowerCase());
        return byCategory && byQuery;
      }),
    [category, query]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="处理工具库"
        description="系统内置的解析、清洗、切分、识别能力，可组合成知识加工流程。"
        actions={<Button onClick={() => navigate("/skills")}><Workflow className="h-4 w-4" />去编排技能</Button>}
      />

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-4">
          <SearchInput placeholder="搜索工具名称、描述或工具 ID" value={query} onChange={(event) => setQuery(event.target.value)} />
          <SectionCard title="工具分类">
            <div className="space-y-2">
              {categories.map((item) => (
                <button
                  key={item.name}
                  onClick={() => setCategory(item.name)}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm transition ${category === item.name ? "bg-indigo-50 font-medium text-indigo-700" : "hover:bg-slate-50"}`}
                >
                  <span>{item.name}</span>
                  <span>{item.count}</span>
                </button>
              ))}
            </div>
          </SectionCard>
        </aside>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((tool) => (
            <button key={tool.id} onClick={() => setSelected(tool)} className="rounded-2xl border bg-white p-5 text-left shadow-soft transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-glow">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-950">{tool.name}</p>
                  <p className="mt-1 font-mono text-xs text-slate-500">{tool.toolId}</p>
                </div>
                <Badge variant="secondary">{tool.category}</Badge>
              </div>
              <p className="mt-4 min-h-[48px] text-sm leading-6 text-slate-600">{tool.description}</p>
              <div className="mt-5 grid grid-cols-3 gap-2 text-sm">
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">调用次数</p>
                  <p className="mt-1 font-semibold">{formatNumber(tool.calls)}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">平均耗时</p>
                  <p className="mt-1 font-semibold">{tool.latency}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">成功率</p>
                  <p className="mt-1 font-semibold">{tool.successRate}</p>
                </div>
              </div>
            </button>
          ))}
        </section>
      </div>

      <DetailDrawer open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)} title={selected?.name ?? "工具详情"} description={selected?.toolId}>
        {selected && (
          <div className="space-y-5">
            {[
              ["输入格式", selected.input],
              ["输出格式", selected.output],
              ["适用场景", selected.scenario]
            ].map(([label, value]) => (
              <SectionCard key={label} title={label}>
                <p className="leading-7 text-slate-700">{value}</p>
              </SectionCard>
            ))}
            <SectionCard title="参数说明">
              <div className="grid gap-3">
                {selected.params.map((param) => (
                  <div key={param} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                    <ArrowRight className="h-4 w-4 text-indigo-500" />
                    <span>{param}</span>
                  </div>
                ))}
              </div>
            </SectionCard>
            <SectionCard title="运行指标">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-indigo-50 p-4"><p className="text-sm text-slate-500">调用次数</p><p className="mt-1 text-xl font-semibold">{formatNumber(selected.calls)}</p></div>
                <div className="rounded-xl bg-emerald-50 p-4"><p className="text-sm text-slate-500">平均耗时</p><p className="mt-1 text-xl font-semibold">{selected.latency}</p></div>
                <div className="rounded-xl bg-amber-50 p-4"><p className="text-sm text-slate-500">成功率</p><p className="mt-1 text-xl font-semibold">{selected.successRate}</p></div>
              </div>
            </SectionCard>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}
