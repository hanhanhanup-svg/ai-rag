import { FileLock2, KeyRound, LockKeyhole, Plus, ShieldCheck, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatCard } from "@/components/common/StatCard";
import { DataTable, type TableColumn } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { authPolicyList, type KnowledgeAuthPolicy } from "@/data/mock/precisionGovernance";
import { useAppStore } from "@/store/useAppStore";

export default function KnowledgeAuthPolicyPage() {
  const addToast = useAppStore((state) => state.addToast);

  const policyColumns: TableColumn<KnowledgeAuthPolicy>[] = [
    { key: "name", title: "策略名称", render: (row) => <span className="font-medium text-slate-900">{row.name}</span>, className: "min-w-[180px]" },
    { key: "scope", title: "适用知识范围", render: (row) => row.scope, className: "min-w-[160px]" },
    { key: "type", title: "知识类型", render: (row) => <Badge variant="secondary">{row.knowledgeType}</Badge> },
    { key: "sensitivity", title: "知识密级", render: (row) => <Badge variant={row.sensitivity.includes("敏感") || row.sensitivity.includes("受限") ? "warning" : "outline"}>{row.sensitivity}</Badge> },
    { key: "roles", title: "可访问角色", render: (row) => row.roles, className: "min-w-[180px]" },
    { key: "departments", title: "可访问部门", render: (row) => row.departments, className: "min-w-[190px]" },
    { key: "scenarios", title: "可调用场景", render: (row) => row.scenarios, className: "min-w-[210px]" },
    { key: "view", title: "查看权限", render: (row) => row.viewPermission },
    { key: "quote", title: "引用权限", render: (row) => row.quotePermission },
    { key: "download", title: "下载权限", render: (row) => row.downloadPermission },
    { key: "edit", title: "编辑权限", render: (row) => row.editPermission },
    { key: "review", title: "审核权限", render: (row) => row.reviewPermission },
    { key: "agent", title: "智能体调用权限", render: (row) => <Badge variant={row.agentPermission === "允许" ? "success" : "warning"}>{row.agentPermission}</Badge>, className: "min-w-[140px]" },
    { key: "external", title: "对外输出权限", render: (row) => <Badge variant={row.externalPermission === "允许" ? "success" : "danger"}>{row.externalPermission}</Badge>, className: "min-w-[120px]" },
    { key: "status", title: "状态", render: (row) => <StatusBadge status={row.status} /> },
    { key: "updated", title: "最近更新时间", render: (row) => row.updatedAt, className: "min-w-[150px]" }
  ];

  const simulate = (title: string) => addToast({ title, description: "知识鉴权策略已在前端模拟执行。", type: "success" });

  return (
    <div className="space-y-6">
      <PageHeader
        title="知识鉴权策略"
        description="配置知识级别的查看、引用、下载、编辑、审核、智能体调用和对外输出边界。"
        actions={
          <>
            <Button variant="outline" onClick={() => simulate("已开始策略冲突检测")}>
              <Sparkles className="h-4 w-4" />
              策略检测
            </Button>
            <Button onClick={() => simulate("已打开新建策略面板")}>
              <Plus className="h-4 w-4" />
              新建策略
            </Button>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <SectionCard title="策略说明" description="防止用户通过问答绕过知识权限边界。">
          <div className="rounded-3xl bg-gradient-to-br from-indigo-50 via-white to-emerald-50 p-5">
            <div className="flex gap-3">
              <ShieldCheck className="mt-1 h-5 w-5 text-emerald-600" />
              <p className="text-sm leading-7 text-slate-700">
                知识鉴权策略用于控制不同知识在不同角色、部门和应用场景下的访问、引用、下载、编辑、审核和智能体调用权限，防止用户通过问答绕过知识权限边界。
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-3">
            {[
              ["问答前校验", "先根据问题场景和权限标签限定检索范围"],
              ["生成中拦截", "答案生成时过滤禁止引用、禁止对外输出知识"],
              ["输出后留痕", "记录用户、问题、命中知识、版本和权限策略"]
            ].map(([title, desc]) => (
              <div key={title} className="rounded-2xl border bg-white p-4">
                <p className="font-semibold text-slate-950">{title}</p>
                <p className="mt-1 text-sm leading-6 text-slate-500">{desc}</p>
              </div>
            ))}
          </div>
        </SectionCard>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="启用策略" value="3" hint="覆盖核心知识调用" tone="success" icon={FileLock2} />
          <StatCard label="限制调用知识" value="118" hint="敏感或受限知识" tone="warning" icon={LockKeyhole} />
          <StatCard label="禁止对外输出" value="236" hint="内部、敏感和核心知识" tone="danger" icon={ShieldCheck} />
          <StatCard label="本周拦截" value="42" hint="越权问答或输出尝试" tone="normal" icon={KeyRound} />
        </div>
      </div>

      <SectionCard
        title="策略配置表"
        description="按知识范围、类型、密级、角色、部门和场景配置可访问与可调用边界。"
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => simulate("已导出策略清单")}>导出</Button>
            <Button size="sm" onClick={() => simulate("已批量启用选中策略")}>批量启用</Button>
          </>
        }
      >
        <DataTable columns={policyColumns} data={authPolicyList} rowKey={(row) => row.id} />
      </SectionCard>

      <SectionCard title="策略命中演示" description="模拟用户提问后，系统如何按策略裁剪知识范围。">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ["用户问题", "数据共享审批流程是什么？", "流程咨询场景，命中数据安全制度调用策略"],
            ["权限判断", "当前用户属于数据部 / 管理员", "允许查看、引用和智能体调用"],
            ["输出控制", "内部报告可引用，禁止对外输出", "答案底部保留来源和权限状态"]
          ].map(([title, value, desc]) => (
            <div key={title} className="rounded-2xl border bg-slate-50 p-5">
              <Badge variant="outline">{title}</Badge>
              <p className="mt-3 font-semibold text-slate-950">{value}</p>
              <p className="mt-2 text-sm leading-6 text-slate-500">{desc}</p>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
