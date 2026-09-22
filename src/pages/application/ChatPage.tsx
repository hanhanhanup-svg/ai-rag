import { useMemo, useState } from "react";
import {
  BadgeCheck,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  GitBranch,
  LockKeyhole,
  MessageSquarePlus,
  Send,
  ShieldCheck,
  Sparkles,
  Tags,
  ThumbsDown,
  ThumbsUp,
  UserCheck
} from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  chatScenarioList,
  matchedKnowledgeList,
  questionUnderstandingMock,
  recommendedQuestions
} from "@/data/mock/precisionGovernance";
import { useAppStore } from "@/store/useAppStore";
import { useAuthStore } from "@/auth/authStore";

const answerSections = [
  {
    title: "结论",
    content:
      "根据《数据安全管理办法》V2.0 第三章“数据共享管理”相关要求，数据共享需经过需求提出、部门初审、安全评估、授权审批、共享登记、使用留痕六个环节。"
  },
  {
    title: "适用场景",
    content: "适用于内部数据共享、跨部门数据调用、敏感数据申请、数据服务接口开通和内部报告取数等场景。"
  },
  {
    title: "办理步骤",
    content: "1. 业务部门提出共享需求；2. 数据归口部门完成初审；3. 安全合规部门开展安全评估；4. 授权负责人审批；5. 完成共享登记；6. 系统记录调用与使用留痕。"
  },
  {
    title: "责任部门",
    content: "需求部门负责提出申请和使用说明，数据管理部负责流程受理与登记，安全合规部负责风险评估，系统管理员负责权限开通和留痕。"
  },
  {
    title: "风险提示",
    content: "涉及敏感或受限数据时，不得绕过审批直接共享；对外输出前必须完成脱敏校验和输出权限复核。"
  },
  {
    title: "来源依据",
    content: "《数据安全管理办法》V2.0，第三章 数据共享管理；《数据共享流程操作手册》，第二章 共享申请与审批。"
  }
];

const sourceEvidence = [
  ["来源文件", "《数据安全管理办法》V2.0"],
  ["章节位置", "第三章 数据共享管理"],
  ["可信等级", "S级权威知识"],
  ["质量评分", "96 分"],
  ["知识状态", "已发布 / 当前有效"],
  ["权限状态", "当前用户可查看、可引用、可用于内部报告"]
];

export default function ChatPage() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const addToast = useAppStore((state) => state.addToast);
  const [activeScenarioId, setActiveScenarioId] = useState("process");
  const [question, setQuestion] = useState("");
  const [activeQuestion, setActiveQuestion] = useState("数据共享审批流程是什么？");

  const activeScenario = useMemo(
    () => chatScenarioList.find((item) => item.id === activeScenarioId) ?? chatScenarioList[0],
    [activeScenarioId]
  );

  const ask = (value = question) => {
    const normalized = value.trim();
    if (!normalized) return;
    setActiveQuestion(normalized);
    setQuestion("");
    addToast({ title: "已完成问题理解与知识命中", description: "右侧已展示标签、场景、权限和来源依据。", type: "success" });
  };

  const feedback = (label: string) => {
    addToast({ title: `已记录反馈：${label}`, description: "反馈将进入知识质量与答案优化闭环。", type: label === "不准确" ? "warning" : "success" });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="智能问答"
        description="用户提问后，系统自动识别意图、匹配标签、限定知识范围、校验权限，并基于可信来源生成可追溯答案。"
      />

      <div className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)_380px]">
        <aside className="space-y-5">
          <SectionCard title="场景选择" description="不同场景会影响标签匹配、答案模板和输出权限。">
            <div className="grid gap-2">
              {chatScenarioList.map((scenario) => (
                <button
                  key={scenario.id}
                  onClick={() => setActiveScenarioId(scenario.id)}
                  className={`rounded-2xl border p-4 text-left transition hover:border-indigo-200 hover:bg-indigo-50/50 ${
                    activeScenarioId === scenario.id ? "border-indigo-300 bg-indigo-50 shadow-sm" : "bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-slate-950">{scenario.name}</p>
                    {activeScenarioId === scenario.id && <CheckCircle2 className="h-4 w-4 text-indigo-600" />}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{scenario.description}</p>
                </button>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="推荐问题">
            <div className="space-y-2">
              {recommendedQuestions.map((item) => (
                <button
                  key={item}
                  onClick={() => ask(item)}
                  className="block w-full rounded-2xl bg-slate-50 p-3 text-left text-sm leading-6 transition hover:bg-indigo-50 hover:text-indigo-700"
                >
                  {item}
                </button>
              ))}
            </div>
          </SectionCard>
        </aside>

        <section className="flex min-h-[760px] flex-col overflow-hidden rounded-[2rem] border bg-white shadow-soft">
          <div className="border-b bg-gradient-to-r from-indigo-50 via-white to-emerald-50 px-6 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-600 text-white">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold text-slate-950">X-RAG 可信问答</p>
                  <p className="text-sm text-slate-500">当前角色：{currentUser?.roleName ?? "演示用户"} · {currentUser?.businessDomain ?? "知识业务域"}</p>
                </div>
              </div>
              <Badge variant="success">当前场景：{activeScenario.name}</Badge>
            </div>
          </div>

          <div className="subtle-scrollbar flex-1 space-y-5 overflow-y-auto bg-slate-50/70 p-6">
            <div className="flex justify-end">
              <div className="max-w-[78%] rounded-3xl bg-indigo-600 px-5 py-4 text-white shadow-sm">
                <p className="text-sm leading-7">{activeQuestion}</p>
              </div>
            </div>

            <div className="flex justify-start">
              <div className="max-w-[88%] rounded-3xl border bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="success">可信答案</Badge>
                  <Badge variant="outline">已完成权限校验</Badge>
                  <Badge variant="outline">基于 2 条权威知识</Badge>
                </div>
                <p className="mt-4 text-sm leading-7 text-slate-700">
                  根据《数据安全管理办法》V2.0 第三章“数据共享管理”相关要求，数据共享需经过需求提出、部门初审、安全评估、授权审批、共享登记、使用留痕六个环节。该流程适用于内部数据共享、跨部门数据调用和敏感数据申请等场景。
                </p>

                <div className="mt-5 grid gap-3">
                  {answerSections.map((section) => (
                    <div key={section.title} className="rounded-2xl bg-slate-50 p-4">
                      <div className="flex items-center gap-2">
                        <ClipboardCheck className="h-4 w-4 text-indigo-600" />
                        <p className="font-semibold text-slate-950">{section.title}</p>
                      </div>
                      <p className="mt-2 text-sm leading-7 text-slate-600">{section.content}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-600" />
                    <p className="font-semibold text-emerald-800">来源依据与权限状态</p>
                  </div>
                  <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                    {sourceEvidence.map(([label, value]) => (
                      <p key={label} className="rounded-xl bg-white/75 px-3 py-2 text-slate-600">
                        <span className="text-slate-400">{label}：</span>
                        {value}
                      </p>
                    ))}
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  {["有帮助", "不准确", "需要补充", "申请人工确认"].map((label) => (
                    <Button key={label} size="sm" variant={label === "有帮助" ? "default" : "outline"} onClick={() => feedback(label)}>
                      {label === "有帮助" && <ThumbsUp className="h-4 w-4" />}
                      {label === "不准确" && <ThumbsDown className="h-4 w-4" />}
                      {label === "需要补充" && <MessageSquarePlus className="h-4 w-4" />}
                      {label === "申请人工确认" && <UserCheck className="h-4 w-4" />}
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="border-t bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-500">当前场景</span>
              <Badge variant="default">{activeScenario.name}</Badge>
              <Badge variant="outline">自动匹配标签与知识范围</Badge>
            </div>
            <div className="flex gap-3">
              <Input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && ask()}
                placeholder="输入制度、流程、指标、报告或合规类问题..."
                className="h-12 rounded-2xl"
              />
              <Button size="lg" onClick={() => ask()}>
                <Send className="h-4 w-4" />
                发送
              </Button>
            </div>
          </div>
        </section>

        <aside className="space-y-5">
          <SectionCard title="问题理解" description="由问题自动推断意图、标签、场景和检索范围。">
            <div className="space-y-4">
              <div className="grid gap-3 text-sm">
                <div className="rounded-2xl bg-indigo-50 p-4">
                  <p className="text-xs text-indigo-500">识别意图</p>
                  <p className="mt-1 font-semibold text-indigo-800">{questionUnderstandingMock.intent}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs text-slate-500">匹配领域</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {questionUnderstandingMock.domains.map((item) => <Badge key={item} variant="secondary">{item}</Badge>)}
                  </div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs text-slate-500">匹配标签</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {questionUnderstandingMock.tags.map((item) => <Badge key={item} variant="outline">{item}</Badge>)}
                  </div>
                </div>
              </div>

              {[
                ["匹配场景", questionUnderstandingMock.scenario, GitBranch],
                ["答案模板", questionUnderstandingMock.answerTemplate, FileText],
                ["权限校验", questionUnderstandingMock.permissionCheck, LockKeyhole],
                ["调用策略", questionUnderstandingMock.strategy, Bot]
              ].map(([label, value, Icon]) => {
                const DisplayIcon = Icon as typeof GitBranch;
                return (
                  <div key={label as string} className="flex gap-3 rounded-2xl border bg-white p-4">
                    <DisplayIcon className="mt-1 h-4 w-4 text-indigo-600" />
                    <div>
                      <p className="text-xs text-slate-500">{label as string}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-700">{value as string}</p>
                    </div>
                  </div>
                );
              })}

              <div className="rounded-2xl border bg-white p-4">
                <div className="flex items-center gap-2">
                  <Tags className="h-4 w-4 text-indigo-600" />
                  <p className="text-sm font-semibold">检索范围</p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {questionUnderstandingMock.retrievalScope.map((item) => <Badge key={item} variant="success">{item}</Badge>)}
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="命中知识依据" description="系统会展示为什么命中、是否可信、是否可用。">
            <div className="space-y-3">
              {matchedKnowledgeList.map((item, index) => (
                <div key={item.id} className="knowledge-card rounded-2xl border bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-950">命中知识 {index + 1}</p>
                      <p className="mt-1 text-sm font-medium text-slate-800">{item.name}</p>
                    </div>
                    <Badge variant={item.trustLevel === "S级" ? "success" : "default"}>{item.trustLevel}</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-slate-500">
                    <p>质量评分：<span className="font-semibold text-indigo-600">{item.qualityScore}</span></p>
                    <p>状态：{item.status} · 生效时间：{item.effectiveAt}</p>
                    <p>命中原因：{item.reason}</p>
                    <p>可用场景：{item.scenarios.join("、")}</p>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="可信调用状态">
            <div className="grid gap-3">
              {[
                ["权限边界", "当前用户可查看、可引用、可用于内部报告", BadgeCheck],
                ["输出控制", "禁止自动生成对外材料", ShieldCheck],
                ["调用留痕", "本次问答已记录问题、知识、版本和反馈", GitBranch]
              ].map(([label, value, Icon]) => {
                const DisplayIcon = Icon as typeof BadgeCheck;
                return (
                  <div key={label as string} className="flex gap-3 rounded-2xl bg-slate-50 p-4">
                    <DisplayIcon className="mt-1 h-4 w-4 text-emerald-600" />
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{label as string}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">{value as string}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        </aside>
      </div>
    </div>
  );
}
