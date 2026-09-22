import { ShieldCheck, UsersRound } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { MetricCard } from "@/components/common/MetricCard";
import { SectionCard } from "@/components/common/SectionCard";
import { DataTable, type TableColumn } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { auditLogs } from "@/data/mock/auditLogs";
import { accessLabels, sensitivityLevels } from "@/data/mock/permissions";
import { platformRoles, platformUsers } from "@/data/mock/workspace";
import { useAppStore } from "@/store/useAppStore";
import type { PlatformRole, PlatformUser } from "@/types";

export function SecurityOverviewPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="权限概览" description="用密级、访问标签、用户角色和审计记录确保知识只给对的人。" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="平台用户" value="8" description="启用 7 人" icon={<UsersRound className="h-5 w-5 text-indigo-500" />} />
        <MetricCard title="最高密级" value="L4绝密" description="2 人拥有" icon={<ShieldCheck className="h-5 w-5 text-emerald-500" />} />
        <MetricCard title="安全告警" value="0" description="高危 0，中危 0" />
        <MetricCard title="SSO 状态" value="未启用" description="建议接入统一身份" />
      </div>
      <SectionCard title="角色视角" description="不同角色进入系统会看到不同重点。">
        <div className="grid gap-4 md:grid-cols-3">
          {platformRoles.slice(0, 6).map((role) => (
            <div key={role.id} className="rounded-3xl border bg-white p-5 shadow-sm">
              <p className="font-semibold">{role.name}</p>
              <p className="mt-2 text-sm leading-6 text-slate-500">{role.description}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {role.permissions.slice(0, 2).map((permission) => <Badge key={permission} variant="secondary">{permission}</Badge>)}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

export function SecurityLevelsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="密级配置" description="密级是知识条目的访问门槛，用户必须具备对应权限才能搜索和问答引用。" />
      <div className="grid gap-4 xl:grid-cols-4">
        {sensitivityLevels.map((level) => (
          <SectionCard key={level.level} title={level.level} description={level.description}>
            <p className="text-sm leading-6 text-slate-600">示例：{level.examples}</p>
            <div className="mt-5 rounded-2xl bg-slate-50 p-4">
              <p className="text-sm text-slate-500">条目数</p>
              <p className="mt-1 text-2xl font-semibold">{level.count}</p>
            </div>
          </SectionCard>
        ))}
      </div>
    </div>
  );
}

export function AccessLabelsPage() {
  const columns: TableColumn<(typeof accessLabels)[number]>[] = [
    { key: "label", title: "标签", render: (row) => <span className="font-medium text-slate-900">{row.label}</span> },
    { key: "dimension", title: "维度", render: (row) => row.dimension },
    { key: "item", title: "条目数", render: (row) => row.itemCount },
    { key: "user", title: "用户数", render: (row) => row.userCount },
    { key: "op", title: "操作", render: () => <Button size="sm" variant="outline">配置</Button> }
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="访问标签" description="用部门、职级、项目组等标签进一步控制知识可见范围。" />
      <SectionCard title="访问标签列表">
        <DataTable columns={columns} data={accessLabels} rowKey={(row) => row.label} />
      </SectionCard>
    </div>
  );
}

export function UsersRolesPage() {
  const addToast = useAppStore((state) => state.addToast);
  const userColumns: TableColumn<PlatformUser>[] = [
    { key: "name", title: "用户", render: (row) => <span className="font-medium text-slate-900">{row.name}</span> },
    { key: "department", title: "部门", render: (row) => row.department },
    { key: "role", title: "角色", render: (row) => row.role },
    { key: "kb", title: "可访问知识库", render: (row) => row.knowledgeBases },
    { key: "level", title: "最高密级", render: (row) => row.maxSensitivity },
    { key: "status", title: "状态", render: (row) => <StatusBadge status={row.status} /> },
    { key: "login", title: "最近登录", render: (row) => row.lastLogin },
    { key: "op", title: "操作", render: (row) => <Button size="sm" variant="outline" onClick={() => addToast({ title: "用户配置已更新", description: row.name, type: "success" })}>配置</Button> }
  ];
  const roleColumns: TableColumn<PlatformRole>[] = [
    { key: "name", title: "角色", render: (row) => <span className="font-medium text-slate-900">{row.name}</span> },
    { key: "desc", title: "说明", render: (row) => row.description },
    { key: "count", title: "用户数", render: (row) => row.userCount },
    { key: "permissions", title: "权限", render: (row) => <div className="flex flex-wrap gap-1">{row.permissions.map((item) => <Badge key={item} variant="secondary">{item}</Badge>)}</div> }
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="用户与角色" description="管理用户列表、角色权限矩阵和部门访问范围。" />
      <SectionCard title="用户列表">
        <DataTable columns={userColumns} data={platformUsers} rowKey={(row) => row.id} />
      </SectionCard>
      <SectionCard title="角色权限矩阵">
        <DataTable columns={roleColumns} data={platformRoles} rowKey={(row) => row.id} />
      </SectionCard>
    </div>
  );
}

export function SsoPage() {
  const addToast = useAppStore((state) => state.addToast);
  return (
    <div className="space-y-6">
      <PageHeader title="SSO 配置" description="接入企业统一身份认证，减少账号管理成本。" />
      <SectionCard title="基础配置" description="当前未启用，可配置 SAML 或 OIDC。">
        <div className="grid gap-4 md:grid-cols-2">
          <Input placeholder="协议：SAML / OIDC" />
          <Input placeholder="身份提供方地址" />
          <Input placeholder="Client ID" />
          <Input placeholder="回调地址" />
        </div>
        <div className="mt-5 flex items-center justify-between rounded-2xl bg-slate-50 p-4">
          <span className="text-sm font-medium">启用 SSO</span>
          <Switch onCheckedChange={() => addToast({ title: "SSO 配置已更新", type: "success" })} />
        </div>
      </SectionCard>
    </div>
  );
}

export function SecurityAlertsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="安全告警" description="关注越权访问、异常调用、密级变更和敏感知识导出风险。" />
      <SectionCard title="今日告警">
        <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-6 text-emerald-700">今日未发现高危或中危安全告警。</div>
      </SectionCard>
    </div>
  );
}

export function SecurityAuditPage() {
  const columns: TableColumn<(typeof auditLogs)[number]>[] = [
    { key: "time", title: "时间", render: (row) => row.time },
    { key: "operator", title: "操作者", render: (row) => row.operator },
    { key: "action", title: "操作", render: (row) => row.action },
    { key: "target", title: "对象", render: (row) => row.target },
    { key: "note", title: "备注", render: (row) => row.note }
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="操作审计" description="记录审核、质量扫描、权限变更和应用接入等关键操作。" />
      <SectionCard title="审计日志">
        <DataTable columns={columns} data={auditLogs} rowKey={(row) => row.id} />
      </SectionCard>
    </div>
  );
}
