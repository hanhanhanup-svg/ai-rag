import { useMemo, useState } from "react";
import { CalendarDays, FileText, Filter, GitBranch, LockKeyhole, Search, ShieldCheck, Tags } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { KnowledgeDetailDrawer } from "@/components/drawers/KnowledgeDetailDrawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { searchResultList } from "@/data/mock/precisionGovernance";
import { useAuthStore } from "@/auth/authStore";
import { getRoleSearchSuggestions } from "@/lib/roleDataFilter";
import type { KnowledgeItem, KnowledgeType, SensitivityLevel } from "@/types";

const domainFilters = ["全部", "数据治理", "数据安全", "数据质量", "数据资产", "招投标"];
const typeFilters = ["全部", "制度类", "流程类", "FAQ类", "指标类", "案例类"];
const trustFilters = ["全部", "S级", "A级", "B级"];
const scoreFilters = ["全部", "90分以上", "80-89分", "70-79分"];
const statusFilters = ["全部", "已发布", "已审核", "当前有效"];
const permissionFilters = ["全部", "可查看", "可引用", "限制引用"];
const scenarioFilters = ["全部", "制度查询", "流程咨询", "合规判断", "报告生成", "标书辅助"];
const outputFilters = ["全部", "可问答", "可引用", "可生成报告", "禁止对外输出"];

function toKnowledgeItem(result: (typeof searchResultList)[number]): KnowledgeItem {
  return {
    id: result.id,
    title: result.title,
    summary: result.summary,
    type: "政策" as KnowledgeType,
    knowledgeBase: "数据安全知识库",
    tags: result.tags,
    sensitivity: "内部" as SensitivityLevel,
    qualityScore: result.qualityScore,
    relevance: result.qualityScore,
    updatedAt: "2026-05-21",
    sourceFile: result.sourceFile,
    status: "有效",
    reviewer: "张明",
    approvedAt: "2026-01-01"
  };
}

export default function SearchPage() {
  const [selected, setSelected] = useState<KnowledgeItem | null>(null);
  const [domain, setDomain] = useState("全部");
  const [type, setType] = useState("全部");
  const [trust, setTrust] = useState("全部");
  const [score, setScore] = useState("全部");
  const [status, setStatus] = useState("全部");
  const [permission, setPermission] = useState("全部");
  const [scenario, setScenario] = useState("全部");
  const [output, setOutput] = useState("全部");
  const currentUser = useAuthStore((state) => state.currentUser);
  const scopedKeywords = getRoleSearchSuggestions(currentUser);

  const results = useMemo(() => {
    return searchResultList.filter((item) => {
      if (trust !== "全部" && item.trustLevel !== trust) return false;
      if (score === "90分以上" && item.qualityScore < 90) return false;
      if (score === "80-89分" && (item.qualityScore < 80 || item.qualityScore > 89)) return false;
      if (score === "70-79分" && (item.qualityScore < 70 || item.qualityScore > 79)) return false;
      if (status !== "全部" && !`${item.knowledgeStatus} ${item.versionStatus}`.includes(status.replace("当前有效", "当前"))) return false;
      if (permission !== "全部" && !item.permissionStatus.includes(permission.replace("可查看", "可查看").replace("可引用", "可引用"))) return false;
      if (scenario !== "全部" && !item.scenarios.includes(scenario)) return false;
      if (domain !== "全部" && !`${item.title} ${item.summary} ${item.tags.join(" ")}`.includes(domain.replace("数据治理", "数据共享"))) return false;
      if (type !== "全部" && type === "FAQ类") return false;
      if (output !== "全部" && output === "禁止对外输出") return item.title.includes("敏感");
      return true;
    });
  }, [domain, output, permission, scenario, score, status, trust, type]);

  const filterGroups = [
    ["所属领域", domain, setDomain, domainFilters],
    ["知识类型", type, setType, typeFilters],
    ["可信等级", trust, setTrust, trustFilters],
    ["质量评分", score, setScore, scoreFilters],
    ["知识状态", status, setStatus, statusFilters],
    ["权限状态", permission, setPermission, permissionFilters],
    ["场景标签", scenario, setScenario, scenarioFilters],
    ["输出标签", output, setOutput, outputFilters]
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader title="知识搜索" description="精准检索会解释命中原因、标签匹配、可信等级、质量评分、权限状态和来源位置。" />

      <section className="rounded-3xl bg-[#171D31] p-6 text-white shadow-soft">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[320px] flex-1">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <Input className="h-[52px] rounded-2xl border-white/10 bg-white/10 pl-12 text-white placeholder:text-slate-400" defaultValue="数据共享审批流程是什么？" />
          </div>
          <Button size="lg"><Search className="h-4 w-4" />精准检索</Button>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-400">推荐关键词：</span>
          {["数据共享审批流程", "权限审批", "安全评估", ...scopedKeywords.slice(0, 3)].map((keyword) => (
            <Badge key={keyword} variant="outline" className="border-white/20 bg-white/10 text-white">{keyword}</Badge>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <aside className="space-y-5">
          <SectionCard title="精准过滤条件" description="过滤项会共同决定检索范围和答案可用边界。" actions={<Filter className="h-4 w-4 text-slate-400" />}>
            <div className="space-y-4">
              {filterGroups.map(([label, value, setter, options]) => (
                <label key={label} className="block space-y-2 text-sm font-medium">
                  <span>{label}</span>
                  <Select value={value} onValueChange={setter}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {options.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </label>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="检索策略" description="本次检索会优先选择权威、当前有效、当前用户可用的知识。">
            <div className="space-y-3">
              {[
                ["标签匹配", "问题命中数据共享、权限审批、安全评估"],
                ["权限校验", "只检索当前用户可查看与可引用知识"],
                ["可信排序", "S级与A级知识优先召回"],
                ["输出控制", "对外受限知识不会进入外部材料生成"]
              ].map(([title, desc]) => (
                <div key={title} className="rounded-2xl bg-slate-50 p-4">
                  <p className="font-medium text-slate-900">{title}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{desc}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        </aside>

        <section className="space-y-5">
          <SectionCard>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-950">检索结果 {results.length} 条</p>
                <p className="mt-1 text-sm text-slate-500">已按可信等级、质量评分、权限状态和场景匹配排序。</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="success">权限校验通过</Badge>
                <Badge variant="outline">当前有效</Badge>
                <Badge variant="outline">A级以上优先</Badge>
              </div>
            </div>
          </SectionCard>

          <div className="space-y-4">
            {results.map((item) => (
              <article key={item.id} className="knowledge-card rounded-2xl border bg-white p-5 shadow-soft">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-950">{item.title}</h3>
                    <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">{item.summary}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={item.trustLevel === "S级" ? "success" : "default"}>{item.trustLevel}</Badge>
                    <Badge variant="outline">质量 {item.qualityScore}</Badge>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
                  <div className="flex items-center gap-2">
                    <Search className="h-4 w-4 text-indigo-600" />
                    <p className="font-semibold text-indigo-900">命中原因</p>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-indigo-800">{item.reason}</p>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="flex items-center gap-2">
                      <Tags className="h-4 w-4 text-indigo-600" />
                      <p className="text-sm font-semibold">匹配标签</p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="flex items-center gap-2">
                      <GitBranch className="h-4 w-4 text-emerald-600" />
                      <p className="text-sm font-semibold">适用场景</p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.scenarios.map((scene) => <Badge key={scene} variant="outline">{scene}</Badge>)}
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-2 xl:grid-cols-4">
                  <p className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2"><ShieldCheck className="h-4 w-4 text-emerald-500" />可信等级：{item.trustLevel}</p>
                  <p className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2"><FileText className="h-4 w-4 text-indigo-500" />版本状态：{item.versionStatus}</p>
                  <p className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2"><LockKeyhole className="h-4 w-4 text-amber-500" />权限状态：{item.permissionStatus}</p>
                  <p className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2"><CalendarDays className="h-4 w-4 text-sky-500" />知识状态：{item.knowledgeStatus}</p>
                  <p className="rounded-xl bg-slate-50 px-3 py-2 xl:col-span-2">来源文件：{item.sourceFile}</p>
                  <p className="rounded-xl bg-slate-50 px-3 py-2 xl:col-span-2">章节位置：{item.chapter}</p>
                </div>

                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <Button size="sm" variant="outline">查看来源片段</Button>
                  <Button size="sm" onClick={() => setSelected(toKnowledgeItem(item))}>查看知识身份证</Button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>

      <KnowledgeDetailDrawer open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)} item={selected} />
    </div>
  );
}
