import { useState } from "react";
import { Download, Plus, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { MetricCard } from "@/components/common/MetricCard";
import { SectionCard } from "@/components/common/SectionCard";
import { DataTable, type TableColumn } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/common/Tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { accessLabels, platformUsers, securityPolicies, sensitivityLevels } from "@/data/mock/permissions";
import { auditLogs } from "@/data/mock/auditLogs";
import { useAppStore } from "@/store/useAppStore";

export default function PermissionsPage() {
  const [open, setOpen] = useState(false);
  const addToast = useAppStore((state) => state.addToast);

  const accessColumns: TableColumn<(typeof accessLabels)[number]>[] = [
    { key: "label", title: "标签", render: (row) => <span className="font-medium text-slate-900">{row.label}</span> },
    { key: "dimension", title: "维度", render: (row) => row.dimension },
    { key: "item", title: "条目数", render: (row) => row.itemCount },
    { key: "user", title: "用户数", render: (row) => row.userCount },
    { key: "op", title: "操作", render: () => <Button size="sm" variant="outline">配置</Button> }
  ];

  const auditColumns: TableColumn<(typeof auditLogs)[number]>[] = [
    { key: "time", title: "时间", render: (row) => row.time },
    { key: "operator", title: "操作者", render: (row) => row.operator },
    { key: "action", title: "操作", render: (row) => row.action },
    { key: "target", title: "对象", render: (row) => row.target },
    { key: "note", title: "备注", render: (row) => row.note }
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="权限与安全管理"
        description="管理密级定义、访问标签体系、SSO 配置及安全告警。"
        actions={
          <>
            <Button variant="outline" onClick={() => addToast({ title: "审计日志已导出", type: "success" })}><Download className="h-4 w-4" />导出审计日志</Button>
            <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />新建策略</Button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="平台用户数" value="3" description="本月新增 0 人" icon={<Users className="h-5 w-5 text-indigo-500" />} />
        <MetricCard title="访问标签数" value="0" description="覆盖 0 个维度" />
        <MetricCard title="安全告警" value="0" description="高危 0，中危 0" icon={<ShieldAlert className="h-5 w-5 text-emerald-500" />} />
        <MetricCard title="SSO 状态" value="未启用" description="未配置协议" icon={<ShieldCheck className="h-5 w-5 text-amber-500" />} />
      </div>

      <Tabs defaultValue="sensitivity">
        <TabsList>
          <TabsTrigger value="sensitivity">密级配置</TabsTrigger>
          <TabsTrigger value="access">访问标签</TabsTrigger>
          <TabsTrigger value="accounts">外部账号</TabsTrigger>
          <TabsTrigger value="sso">SSO 配置</TabsTrigger>
          <TabsTrigger value="alerts">安全告警</TabsTrigger>
          <TabsTrigger value="audit">操作审计</TabsTrigger>
        </TabsList>

        <TabsContent value="sensitivity" className="space-y-5">
          <SectionCard>
            <p className="leading-7 text-slate-600">
              密级是知识条目的最高访问门槛，用户必须具备对应密级权限才能在 RAG 检索中获取该知识。C 端 API 最高密级强制为公开 L1。密级变更需人工审批，遵循四眼原则。
            </p>
          </SectionCard>
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
        </TabsContent>

        <TabsContent value="access">
          <SectionCard title="访问标签" description="用部门、职级、项目组等标签进一步控制知识可见范围。">
            <DataTable columns={accessColumns} data={accessLabels} rowKey={(row) => row.label} />
          </SectionCard>
        </TabsContent>

        <TabsContent value="accounts">
          <SectionCard title="外部账号" description="管理平台用户与外部身份的映射关系。">
            <div className="grid gap-3">
              {platformUsers.map((user) => (
                <div key={user.name} className="flex items-center justify-between rounded-2xl border bg-white p-4">
                  <div>
                    <p className="font-medium">{user.name}</p>
                    <p className="mt-1 text-sm text-slate-500">{user.role} · {user.sensitivity}</p>
                  </div>
                  <StatusBadge status={user.status} />
                </div>
              ))}
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="sso">
          <SectionCard title="SSO 配置" description="当前未启用，可接入企业统一身份认证。">
            <div className="grid gap-4 md:grid-cols-2">
              <Input placeholder="协议：SAML / OIDC" />
              <Input placeholder="身份提供方地址" />
              <Input placeholder="Client ID" />
              <Input placeholder="回调地址" />
            </div>
            <div className="mt-5 flex items-center justify-between rounded-2xl bg-slate-50 p-4">
              <span className="text-sm font-medium">启用 SSO</span>
              <Switch />
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="alerts">
          <SectionCard title="安全告警" description="当前没有安全告警。">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-5 text-emerald-700">
              今日未发现越权访问、异常调用或敏感知识导出行为。
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="audit">
          <SectionCard title="操作审计" description="记录关键审核、质量扫描与权限变更操作。">
            <DataTable columns={auditColumns} data={auditLogs} rowKey={(row) => row.id} />
          </SectionCard>
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建安全策略</DialogTitle>
            <DialogDescription>创建前端演示策略，用于说明安全检测与审计能力。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <label className="space-y-2 text-sm font-medium">
              <span>策略名称</span>
              <Input placeholder="例如：API 调用异常检测" />
            </label>
            <label className="space-y-2 text-sm font-medium">
              <span>策略类型</span>
              <Select defaultValue={securityPolicies[0]}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {securityPolicies.map((policy) => <SelectItem key={policy} value={policy}>{policy}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="flex items-center justify-between rounded-2xl bg-slate-50 p-4 text-sm font-medium">
              <span>启用策略</span>
              <Switch defaultChecked />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={() => {
              setOpen(false);
              addToast({ title: "安全策略已创建", description: "策略将在下一次安全扫描中生效。", type: "success" });
            }}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
