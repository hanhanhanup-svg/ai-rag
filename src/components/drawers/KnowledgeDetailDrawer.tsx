import { Copy, Edit3, FileBadge2, GitBranch, Heart, History, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/common/SectionCard";
import { DetailDrawer } from "@/components/drawers/DetailDrawer";
import { KnowledgeTypeBadge } from "@/components/common/KnowledgeTypeBadge";
import { SensitivityBadge } from "@/components/common/SensitivityBadge";
import { useAppStore } from "@/store/useAppStore";
import { knowledgeIdentityMock } from "@/data/mock/precisionGovernance";
import type { KnowledgeItem } from "@/types";

interface KnowledgeDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: KnowledgeItem | null;
}

export function KnowledgeDetailDrawer({ open, onOpenChange, item }: KnowledgeDetailDrawerProps) {
  const addToast = useAppStore((state) => state.addToast);

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={item?.title ?? "知识详情"}
      description="查看知识内容、来源依据、质量状态与使用反馈。"
      widthClassName="w-[860px]"
      footer={
        item && (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => addToast({ title: "已复制知识链接", type: "success" })}>
              <Copy className="h-4 w-4" />
              复制链接
            </Button>
            <Button variant="outline" onClick={() => addToast({ title: "已收藏知识", description: item.title, type: "success" })}>
              <Heart className="h-4 w-4" />
              收藏
            </Button>
            <Button variant="outline" onClick={() => addToast({ title: "已发起治理任务", description: "知识运营员将收到处理提醒。", type: "success" })}>
              <Sparkles className="h-4 w-4" />
              发起治理
            </Button>
            <Button onClick={() => addToast({ title: "已进入编辑状态", description: "原型中模拟编辑反馈。" })}>
              <Edit3 className="h-4 w-4" />
              编辑
            </Button>
          </div>
        )
      }
    >
      {item && (
        <div className="space-y-5">
          <div className="rounded-3xl border bg-gradient-to-br from-white to-indigo-50/60 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <KnowledgeTypeBadge type={item.type} />
              <SensitivityBadge level={item.sensitivity} />
              <Badge variant="success">{item.status}</Badge>
              <Badge variant="outline">质量分 {item.qualityScore}</Badge>
            </div>
            <p className="mt-4 text-sm leading-7 text-slate-600">{item.summary}</p>
          </div>

          <SectionCard
            title="知识身份证"
            description="用于问答调用、报告引用、权限校验和来源追溯的可信知识元数据。"
            actions={
              <>
                <Button size="sm" variant="outline" onClick={() => addToast({ title: "已打开调用记录", description: knowledgeIdentityMock.name })}>
                  <History className="h-4 w-4" />
                  查看调用记录
                </Button>
                <Button size="sm" variant="outline" onClick={() => addToast({ title: "已发起重新鉴权", description: "知识负责人将收到复核提醒。", type: "success" })}>
                  <RefreshCw className="h-4 w-4" />
                  发起重新鉴权
                </Button>
                <Button size="sm" onClick={() => addToast({ title: "已提交修订申请", description: knowledgeIdentityMock.name, type: "success" })}>
                  <Edit3 className="h-4 w-4" />
                  申请修订
                </Button>
              </>
            }
          >
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4">
                  <p className="text-xs text-emerald-600">可信等级</p>
                  <p className="mt-2 text-xl font-semibold text-emerald-800">{knowledgeIdentityMock.trustLevel}</p>
                </div>
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/80 p-4">
                  <p className="text-xs text-indigo-600">质量评分</p>
                  <p className="mt-2 text-xl font-semibold text-indigo-800">{knowledgeIdentityMock.qualityScore} 分</p>
                </div>
                <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-4">
                  <p className="text-xs text-sky-600">知识状态</p>
                  <p className="mt-2 text-xl font-semibold text-sky-800">{knowledgeIdentityMock.status}</p>
                </div>
              </div>

              <div className="rounded-2xl border bg-white p-4">
                <div className="flex items-center gap-2">
                  <FileBadge2 className="h-4 w-4 text-indigo-600" />
                  <p className="font-semibold text-slate-950">基础身份</p>
                </div>
                <div className="mt-4 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
                  {[
                    ["知识编号", knowledgeIdentityMock.code],
                    ["知识名称", knowledgeIdentityMock.name],
                    ["来源文件", knowledgeIdentityMock.sourceFile],
                    ["责任部门", knowledgeIdentityMock.department],
                    ["知识负责人", knowledgeIdentityMock.owner],
                    ["知识类型", knowledgeIdentityMock.type],
                    ["所属领域", knowledgeIdentityMock.domain],
                    ["密级", knowledgeIdentityMock.sensitivity],
                    ["版本", knowledgeIdentityMock.version],
                    ["生效时间", knowledgeIdentityMock.effectiveAt],
                    ["失效时间", knowledgeIdentityMock.expiresAt],
                    ["知识状态", knowledgeIdentityMock.status]
                  ].map(([label, value]) => (
                    <p key={label} className="rounded-xl bg-slate-50 px-3 py-2">
                      <span className="text-slate-400">{label}：</span>
                      {value}
                    </p>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border bg-white p-4">
                  <p className="font-semibold text-slate-950">领域标签</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {knowledgeIdentityMock.domainTags.map((tag) => (
                      <Badge key={tag} variant="secondary">{tag}</Badge>
                    ))}
                  </div>
                  <p className="mt-4 font-semibold text-slate-950">场景标签</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {knowledgeIdentityMock.scenarioTags.map((tag) => (
                      <Badge key={tag} variant="outline">{tag}</Badge>
                    ))}
                  </div>
                </div>
                <div className="rounded-2xl border bg-white p-4">
                  <p className="font-semibold text-slate-950">输出与调用权限</p>
                  <div className="mt-3 grid gap-2 text-sm">
                    {[
                      ["是否允许问答调用", knowledgeIdentityMock.qaAllowed],
                      ["是否允许报告引用", knowledgeIdentityMock.reportAllowed],
                      ["是否允许标书引用", knowledgeIdentityMock.tenderAllowed],
                      ["是否允许对外输出", knowledgeIdentityMock.externalAllowed]
                    ].map(([label, allowed]) => (
                      <div key={label as string} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                        <span>{label as string}</span>
                        <Badge variant={allowed ? "success" : "danger"}>{allowed ? "是" : "否"}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="正文">
            <p className="leading-7 text-slate-700">
              {item.summary} 该知识已保留原文依据，可用于知识搜索、智能问答和业务应用引用。审核通过后，系统会持续记录版本、反馈和使用情况。
            </p>
          </SectionCard>

          <SectionCard title="标签与来源">
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {item.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
              <div className="grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
                <p>
                  <span className="text-slate-400">来源文件：</span>
                  {item.sourceFile}
                </p>
                <p>
                  <span className="text-slate-400">来源片段：</span>
                  员工手册相关段落
                </p>
                <p>
                  <span className="text-slate-400">有效期：</span>
                  永久有效
                </p>
                <p>
                  <span className="text-slate-400">最近更新：</span>
                  {item.updatedAt}
                </p>
                <p>
                  <span className="text-slate-400">版本：</span>
                  v{item.id.endsWith("1") ? "3" : "1"}
                </p>
                <p>
                  <span className="text-slate-400">使用次数：</span>
                  {item.relevance + 18}
                </p>
                <p>
                  <span className="text-slate-400">反馈次数：</span>
                  {item.qualityScore < 60 ? 3 : 1}
                </p>
              </div>
            </div>
          </SectionCard>

          <div className="grid gap-4 sm:grid-cols-2">
            <SectionCard title="可信提示">
              <div className="flex gap-3">
                <ShieldCheck className="mt-1 h-5 w-5 text-emerald-500" />
                <p className="text-sm leading-6 text-slate-600">答案将基于你有权限访问的知识生成，引用来源可追溯。</p>
              </div>
            </SectionCard>
            <SectionCard title="版本入口">
              <Button variant="outline" className="w-full" onClick={() => addToast({ title: "已打开版本记录", description: item.title })}>
                <GitBranch className="h-4 w-4" />
                查看版本
              </Button>
            </SectionCard>
          </div>
        </div>
      )}
    </DetailDrawer>
  );
}
