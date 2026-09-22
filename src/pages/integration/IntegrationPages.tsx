import { PlugZap, Webhook as WebhookIcon } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { DataTable, type TableColumn } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { applicationScenarios, webhooks } from "@/data/mock/workspace";
import { apiLogs } from "@/data/mock/apiApps";
import { useAppStore } from "@/store/useAppStore";
import type { ApplicationScenario, WebhookItem } from "@/types";

export function IntegrationAppsPage() {
  const addToast = useAppStore((state) => state.addToast);
  const columns: TableColumn<ApplicationScenario>[] = [
    { key: "name", title: "应用名称", render: (row) => <span className="font-medium text-slate-900">{row.name}</span> },
    { key: "type", title: "应用类型", render: (row) => row.type },
    { key: "owner", title: "负责人", render: (row) => row.owner },
    { key: "kb", title: "接入知识库", render: (row) => row.knowledgeBase },
    { key: "level", title: "最高密级", render: (row) => row.maxSensitivity },
    { key: "calls", title: "今日调用", render: (row) => row.calls },
    { key: "hit", title: "命中率", render: (row) => row.hitRate },
    { key: "status", title: "状态", render: (row) => <StatusBadge status={row.status} /> },
    {
      key: "op",
      title: "操作",
      render: (row) => (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => addToast({ title: "应用配置已更新", description: row.name, type: "success" })}>配置</Button>
          <Button size="sm" variant="outline">查看调用</Button>
          <Button size="sm" variant="outline" onClick={() => addToast({ title: "应用已停用", description: row.name, type: "warning" })}>停用</Button>
        </div>
      )
    }
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="应用接入" description="更直观地管理下游业务应用，让可信知识安全服务到业务场景。" actions={<Button><PlugZap className="h-4 w-4" />新建应用</Button>} />
      <SectionCard title="接入应用列表">
        <DataTable columns={columns} data={applicationScenarios} rowKey={(row) => row.id} />
      </SectionCard>
    </div>
  );
}

export function WebhooksPage() {
  const addToast = useAppStore((state) => state.addToast);
  const columns: TableColumn<WebhookItem>[] = [
    { key: "event", title: "事件类型", render: (row) => <span className="font-medium text-slate-900">{row.eventType}</span> },
    { key: "url", title: "回调地址", render: (row) => row.callbackUrl },
    { key: "status", title: "状态", render: (row) => <StatusBadge status={row.status} /> },
    { key: "triggered", title: "最近触发", render: (row) => row.lastTriggered },
    { key: "op", title: "操作", render: (row) => <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => addToast({ title: "Webhook 测试成功", description: row.eventType, type: "success" })}>测试</Button><Button size="sm" variant="outline">编辑</Button></div> }
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Webhook" description="在知识审核通过、更新、下架或质量问题产生后通知业务系统。" actions={<Button><WebhookIcon className="h-4 w-4" />新增 Webhook</Button>} />
      <SectionCard title="通知事件">
        <DataTable columns={columns} data={webhooks} rowKey={(row) => row.id} />
      </SectionCard>
    </div>
  );
}

export function IntegrationLogsPage() {
  const columns: TableColumn<(typeof apiLogs)[number]>[] = [
    { key: "time", title: "时间", render: (row) => row.time },
    { key: "app", title: "应用", render: (row) => row.app },
    { key: "api", title: "接口", render: (row) => row.api },
    { key: "kb", title: "知识库", render: (row) => row.kb },
    { key: "status", title: "状态", render: (row) => <Badge variant="success">{row.status}</Badge> },
    { key: "cost", title: "耗时", render: (row) => row.cost },
    { key: "tokens", title: "Token 用量", render: (row) => row.tokens },
    { key: "error", title: "错误信息", render: (row) => row.error }
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="调用日志" description="查看业务应用调用知识服务的状态、耗时、Token 用量和错误信息。" />
      <SectionCard title="最近调用">
        <DataTable columns={columns} data={apiLogs} rowKey={(row) => row.time} />
      </SectionCard>
    </div>
  );
}
