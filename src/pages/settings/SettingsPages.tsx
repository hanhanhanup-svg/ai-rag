import { Bell, BookOpen, Database, Settings2, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { DataTable, type TableColumn } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { modelConfigs, notifications, systemLogs } from "@/data/mock/workspace";
import { useAppStore } from "@/store/useAppStore";
import type { ModelConfig, NotificationItem } from "@/types";

export function BasicSettingsPage() {
  const addToast = useAppStore((state) => state.addToast);

  return (
    <div className="space-y-6">
      <PageHeader title="基础设置" description="配置企业知识工作空间的基础信息、默认规则和体验偏好。" />
      <div className="grid gap-6 xl:grid-cols-[1fr_0.8fr]">
        <SectionCard title="空间信息" description="这些信息会展示在平台品牌、通知和导出报告中。">
          <div className="grid gap-4">
            <label className="space-y-2 text-sm font-medium">
              <span>平台名称</span>
              <Input defaultValue="X-RAG 知识工作空间" />
            </label>
            <label className="space-y-2 text-sm font-medium">
              <span>企业名称</span>
              <Input defaultValue="深演智能" />
            </label>
            <label className="space-y-2 text-sm font-medium">
              <span>默认知识库</span>
              <Input defaultValue="测试知识库" />
            </label>
            <Button className="w-fit" onClick={() => addToast({ title: "基础设置已保存", type: "success" })}>
              保存设置
            </Button>
          </div>
        </SectionCard>
        <SectionCard title="体验偏好" description="让普通用户更容易找到知识。">
          <div className="space-y-4">
            {["启用智能推荐问题", "搜索结果展示引用来源", "默认打开知识详情抽屉", "低质量知识给出温和提醒"].map((item) => (
              <label key={item} className="flex items-center justify-between rounded-2xl bg-slate-50 p-4 text-sm font-medium">
                <span>{item}</span>
                <Switch defaultChecked onCheckedChange={() => addToast({ title: "配置已更新", description: item, type: "success" })} />
              </label>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

export function NotificationSettingsPage() {
  const addToast = useAppStore((state) => state.addToast);
  const columns: TableColumn<NotificationItem>[] = [
    { key: "title", title: "通知内容", render: (row) => <span className="font-medium text-slate-900">{row.title}</span> },
    { key: "type", title: "类型", render: (row) => <Badge variant="secondary">{row.type}</Badge> },
    { key: "content", title: "说明", render: (row) => row.content },
    { key: "time", title: "时间", render: (row) => row.time },
    { key: "status", title: "状态", render: (row) => <StatusBadge status={row.read ? "已读" : "未读"} tone={row.read ? "muted" : "normal"} /> }
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="通知设置" description="配置待审核、SLA 超时、治理任务、知识到期、安全告警和 API 异常提醒。" />
      <SectionCard title="提醒开关" description="关键提醒会在顶部通知中心和运营动态中展示。">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {["待审核提醒", "SLA 超时提醒", "治理任务提醒", "知识到期提醒", "安全告警提醒", "API 异常提醒"].map((item) => (
            <label key={item} className="flex items-center justify-between rounded-2xl bg-slate-50 p-4 text-sm font-medium">
              <span className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-indigo-500" />
                {item}
              </span>
              <Switch defaultChecked onCheckedChange={() => addToast({ title: "通知配置已更新", description: item, type: "success" })} />
            </label>
          ))}
        </div>
      </SectionCard>
      <SectionCard title="最近通知">
        <DataTable columns={columns} data={notifications} rowKey={(row) => row.id} />
      </SectionCard>
    </div>
  );
}

export function DictionariesPage() {
  const addToast = useAppStore((state) => state.addToast);
  const dictionaries = [
    { name: "知识类型", count: 9, examples: "FAQ、SOP、政策、合同、合规" },
    { name: "密级字典", count: 4, examples: "公开、内部、机密、绝密" },
    { name: "反馈类型", count: 4, examples: "答案不准、找不到、过期、权限问题" },
    { name: "治理问题", count: 7, examples: "摘要为空、重复冲突、来源不清晰" },
    { name: "应用类型", count: 5, examples: "问答应用、员工服务、学习平台" }
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="字典配置" description="维护平台常用枚举，让知识生产、治理和应用接入表达一致。" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {dictionaries.map((item) => (
          <SectionCard key={item.name} title={item.name} description={item.examples}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-semibold">{item.count}</p>
                <p className="text-sm text-slate-500">字典项</p>
              </div>
              <Button variant="outline" onClick={() => addToast({ title: "字典配置已更新", description: item.name, type: "success" })}>
                编辑
              </Button>
            </div>
          </SectionCard>
        ))}
      </div>
    </div>
  );
}

export function ModelSettingsPage() {
  const addToast = useAppStore((state) => state.addToast);
  const columns: TableColumn<ModelConfig>[] = [
    { key: "usage", title: "模型用途", render: (row) => <span className="font-medium text-slate-900">{row.usage}</span> },
    { key: "name", title: "模型名称", render: (row) => row.modelName },
    { key: "provider", title: "服务商", render: (row) => row.provider },
    { key: "status", title: "状态", render: (row) => <StatusBadge status={row.status} tone={row.status === "使用中" ? "success" : row.status === "备用" ? "normal" : "muted"} /> },
    { key: "updated", title: "更新时间", render: (row) => row.updatedAt },
    {
      key: "op",
      title: "操作",
      render: (row) => (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => addToast({ title: "模型测试通过", description: row.modelName, type: "success" })}>测试</Button>
          <Button size="sm" variant="outline" onClick={() => addToast({ title: "模型已切换", description: row.usage, type: "success" })}>切换</Button>
          <Button size="sm" onClick={() => addToast({ title: "模型配置已保存", description: row.modelName, type: "success" })}>配置</Button>
        </div>
      )
    }
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="模型配置" description="配置问答、Embedding、重排和摘要模型。这里偏管理员配置，普通用户无需感知。" />
      <SectionCard title="模型列表" description="保持低调但完整，确保知识搜索、问答和摘要生成有可控模型能力。">
        <DataTable columns={columns} data={modelConfigs} rowKey={(row) => row.id} />
      </SectionCard>
    </div>
  );
}

export function SystemLogsPage() {
  const columns: TableColumn<(typeof systemLogs)[number]>[] = [
    { key: "time", title: "时间", render: (row) => row.time },
    { key: "module", title: "模块", render: (row) => row.module },
    { key: "action", title: "动作", render: (row) => row.action },
    { key: "operator", title: "操作者", render: (row) => row.operator }
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="系统日志" description="记录平台运行、配置变更和关键任务执行情况。" />
      <SectionCard title="最近系统日志" actions={<Settings2 className="h-5 w-5 text-indigo-500" />}>
        <DataTable columns={columns} data={systemLogs} rowKey={(row) => `${row.time}-${row.action}`} />
      </SectionCard>
    </div>
  );
}

export function SettingsPlaceholder() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {[
        { title: "基础体验", icon: SlidersHorizontal },
        { title: "知识字典", icon: BookOpen },
        { title: "数据记录", icon: Database }
      ].map((item) => (
        <SectionCard key={item.title} title={item.title}>
          <item.icon className="h-6 w-6 text-indigo-500" />
        </SectionCard>
      ))}
    </div>
  );
}
