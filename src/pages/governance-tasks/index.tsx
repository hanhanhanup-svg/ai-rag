import { useState } from "react";
import { Plus, Users } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { FilterBar } from "@/components/common/FilterBar";
import { DataTable, type TableColumn } from "@/components/common/DataTable";
import { MetricCard } from "@/components/common/MetricCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAppStore } from "@/store/useAppStore";
import type { GovernanceTask } from "@/types";

export default function GovernanceTasksPage() {
  const [open, setOpen] = useState(false);
  const tasks = useAppStore((state) => state.governanceTasks);
  const updateTask = useAppStore((state) => state.updateGovernanceTask);
  const addToast = useAppStore((state) => state.addToast);

  const columns: TableColumn<GovernanceTask>[] = [
    { key: "title", title: "任务名称", render: (row) => <span className="font-medium text-slate-900">{row.title}</span> },
    { key: "issue", title: "问题类型", render: (row) => row.issueType },
    { key: "count", title: "关联知识数", render: (row) => row.relatedCount },
    { key: "owner", title: "责任人", render: (row) => row.owner },
    { key: "priority", title: "优先级", render: (row) => <Badge variant={row.priority === "高" ? "danger" : row.priority === "中" ? "warning" : "secondary"}>{row.priority}</Badge> },
    { key: "status", title: "状态", render: (row) => <StatusBadge status={row.status} /> },
    { key: "due", title: "截止时间", render: (row) => row.dueAt },
    { key: "created", title: "创建时间", render: (row) => row.createdAt },
    {
      key: "op",
      title: "操作",
      render: (row) => (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => addToast({ title: "任务详情已打开", description: row.title })}>查看详情</Button>
          <Button size="sm" onClick={() => {
            updateTask(row.id, "已完成");
            addToast({ title: "任务已完成", description: row.title, type: "success" });
          }}>完成任务</Button>
          <Button size="sm" variant="outline" onClick={() => addToast({ title: "已分派责任人", description: row.owner, type: "success" })}>分派</Button>
          <Button size="sm" variant="outline" onClick={() => {
            updateTask(row.id, "已延期");
            addToast({ title: "任务已延期", description: row.title, type: "warning" });
          }}>延期</Button>
        </div>
      )
    }
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="治理任务"
        description="按责任人、优先级和截止时间管理知识修复、补全、复审和下架任务。"
        actions={
          <>
            <Button variant="outline"><Users className="h-4 w-4" />批量分派</Button>
            <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />新建任务</Button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="待处理" value={42} description="等待责任人确认" />
        <MetricCard title="处理中" value={16} description="正在修复或复审" />
        <MetricCard title="已完成" value={28} description="已通过验收闭环" />
        <MetricCard title="已逾期" value={4} description="需要优先跟进" />
      </div>

      <FilterBar>
        <div className="w-40">
          <Select defaultValue="全部状态">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {["全部状态", "待处理", "处理中", "已完成", "已延期"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <Select defaultValue="全部优先级">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {["全部优先级", "高", "中", "低"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Input className="w-40" placeholder="责任人" />
        <div className="w-44">
          <Select defaultValue="全部问题类型">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {["全部问题类型", "摘要缺失", "缺少问题变体", "标签缺失", "来源不清晰", "重复冲突", "已过期"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Input className="w-64" placeholder="搜索任务名称" />
      </FilterBar>

      <DataTable columns={columns} data={tasks} rowKey={(row) => row.id} />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建治理任务</DialogTitle>
            <DialogDescription>为一组知识质量问题创建责任明确的处理任务。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <label className="space-y-2 text-sm font-medium"><span>任务名称</span><Input placeholder="例如：补齐员工制度摘要" /></label>
            <label className="space-y-2 text-sm font-medium">
              <span>问题类型</span>
              <Select defaultValue="摘要为空">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["摘要为空", "缺少问题变体", "标签缺失", "来源不清晰", "重复冲突", "已过期未处理", "密级缺失"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-2 text-sm font-medium"><span>关联知识库</span><Input defaultValue="测试知识库" /></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 text-sm font-medium"><span>责任人</span><Input defaultValue="王强" /></label>
              <label className="space-y-2 text-sm font-medium">
                <span>优先级</span>
                <Select defaultValue="高">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["高", "中", "低"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
            </div>
            <label className="space-y-2 text-sm font-medium"><span>截止时间</span><Input type="date" defaultValue="2026-05-28" /></label>
            <label className="space-y-2 text-sm font-medium"><span>处理说明</span><Textarea placeholder="描述处理方式和验收标准" /></label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={() => {
              setOpen(false);
              addToast({ title: "治理任务已创建", description: "任务已进入待处理看板。", type: "success" });
            }}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
