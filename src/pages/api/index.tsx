import { useState } from "react";
import { BookOpenText, KeyRound, Plus } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
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
import { apiLogs, rateLimits } from "@/data/mock/apiApps";
import { useAppStore } from "@/store/useAppStore";
import type { ApiApp } from "@/types";

export default function ApiPage() {
  const [open, setOpen] = useState(false);
  const apiApps = useAppStore((state) => state.apiApps);
  const addApiApp = useAppStore((state) => state.addApiApp);
  const addToast = useAppStore((state) => state.addToast);

  const appColumns: TableColumn<ApiApp>[] = [
    { key: "name", title: "应用名称", render: (row) => <span className="font-medium text-slate-900">{row.name}</span> },
    { key: "type", title: "应用类型", render: (row) => row.type },
    { key: "key", title: "API Key 状态", render: (row) => <StatusBadge status={row.keyStatus} /> },
    { key: "kb", title: "可访问知识库", render: (row) => row.knowledgeBase },
    { key: "level", title: "最高访问密级", render: (row) => row.maxSensitivity },
    { key: "calls", title: "今日调用", render: (row) => row.todayCalls },
    { key: "success", title: "成功率", render: (row) => row.successRate },
    { key: "status", title: "状态", render: (row) => <StatusBadge status={row.status} /> },
    { key: "op", title: "操作", render: () => <Button size="sm" variant="outline">管理</Button> }
  ];

  const logColumns: TableColumn<(typeof apiLogs)[number]>[] = [
    { key: "time", title: "时间", render: (row) => row.time },
    { key: "app", title: "应用", render: (row) => row.app },
    { key: "api", title: "接口", render: (row) => row.api },
    { key: "kb", title: "知识库", render: (row) => row.kb },
    { key: "status", title: "状态", render: (row) => row.status },
    { key: "cost", title: "耗时", render: (row) => row.cost },
    { key: "tokens", title: "Token 用量", render: (row) => row.tokens },
    { key: "error", title: "错误信息", render: (row) => row.error }
  ];

  const createApp = () => {
    const app: ApiApp = {
      id: `api-${Date.now()}`,
      name: "新接入知识助手",
      type: "内部应用",
      keyStatus: "启用",
      knowledgeBase: "测试知识库",
      maxSensitivity: "L2内部",
      todayCalls: 0,
      successRate: "100%",
      status: "正常"
    };
    addApiApp(app);
    setOpen(false);
    addToast({ title: "应用创建成功", description: "API Key 已生成，可在应用列表中查看。", type: "success" });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="API 管理"
        description="把可信知识安全地提供给业务系统和智能应用，管理接入权限、限流策略和调用日志。"
        actions={
          <>
            <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />新建应用</Button>
            <Button variant="outline"><BookOpenText className="h-4 w-4" />查看调用文档</Button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="接入应用" value="3" hint="全部启用" tone="normal" />
        <StatCard label="本月调用" value="1,284" hint="较上月 +18%" tone="success" />
        <StatCard label="成功率" value="99.3%" hint="服务稳定" tone="success" />
        <StatCard label="平均响应" value="320ms" hint="近 24 小时" tone="normal" />
      </div>

      <Tabs defaultValue="apps">
        <TabsList>
          <TabsTrigger value="apps">应用列表</TabsTrigger>
          <TabsTrigger value="logs">调用日志</TabsTrigger>
          <TabsTrigger value="limits">限流策略</TabsTrigger>
        </TabsList>
        <TabsContent value="apps">
          <SectionCard title="应用列表" description="控制每个下游应用可访问的知识库和最高密级。">
            <DataTable columns={appColumns} data={apiApps} rowKey={(row) => row.id} />
          </SectionCard>
        </TabsContent>
        <TabsContent value="logs">
          <SectionCard title="调用日志" description="查看接口调用状态、耗时、Token 用量和错误信息。">
            <DataTable columns={logColumns} data={apiLogs} rowKey={(row) => row.time} />
          </SectionCard>
        </TabsContent>
        <TabsContent value="limits">
          <SectionCard title="限流策略" description="保护知识服务稳定运行，避免异常调用影响业务。">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              {rateLimits.map((item) => (
                <div key={item.name} className="rounded-2xl border bg-white p-5 shadow-sm">
                  <p className="text-sm text-slate-500">{item.name}</p>
                  <p className="mt-2 font-semibold text-slate-950">{item.value}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建应用</DialogTitle>
            <DialogDescription>创建下游应用接入，并设置可访问知识库、密级和 QPS 限制。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <label className="space-y-2 text-sm font-medium"><span>应用名称</span><Input placeholder="例如：员工服务助手" /></label>
            <label className="space-y-2 text-sm font-medium">
              <span>应用类型</span>
              <Select defaultValue="内部应用">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["问答应用", "内部应用", "分析应用"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-2 text-sm font-medium"><span>可访问知识库</span><Input defaultValue="测试知识库" /></label>
            <label className="space-y-2 text-sm font-medium">
              <span>最高访问密级</span>
              <Select defaultValue="L2内部">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["L1公开", "L2内部", "L3机密"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-2 text-sm font-medium"><span>QPS 限制</span><Input defaultValue="100" /></label>
            <label className="flex items-center justify-between rounded-2xl bg-slate-50 p-4 text-sm font-medium">
              <span>是否启用</span>
              <Switch defaultChecked />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={createApp}><KeyRound className="h-4 w-4" />创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
