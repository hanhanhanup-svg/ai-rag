import { useMemo, useState } from "react";
import { Archive, CalendarClock, Clock3, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { MetricCard } from "@/components/common/MetricCard";
import { SectionCard } from "@/components/common/SectionCard";
import { DataTable, type TableColumn } from "@/components/common/DataTable";
import { KnowledgeTypeBadge } from "@/components/common/KnowledgeTypeBadge";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/common/Tabs";
import { Button } from "@/components/ui/button";
import { lifecycleItems } from "@/data/mock/workspace";
import { useAppStore } from "@/store/useAppStore";
import type { LifecycleItem } from "@/types";

const categories = ["即将到期", "已过期", "长期未更新", "已下架"];
type ReviewItem = Omit<LifecycleItem, "status"> & { status: LifecycleItem["status"] | "已下架"; lastUpdated: string };

export default function LifecyclePage() {
  const [tab, setTab] = useState("即将到期");
  const addToast = useAppStore((state) => state.addToast);
  const data = useMemo<ReviewItem[]>(() => {
    const withUpdated = lifecycleItems.map((item) => ({ ...item, lastUpdated: "2026-05-21" }));
    if (tab === "已下架") return withUpdated.slice(0, 5).map((item) => ({ ...item, status: "已下架" }));
    return withUpdated.filter((item) => item.status === tab);
  }, [tab]);

  const columns: TableColumn<ReviewItem>[] = [
    { key: "title", title: "知识标题", render: (row) => <span className="font-medium text-slate-900">{row.title}</span> },
    { key: "kb", title: "所属知识库", render: (row) => row.knowledgeBase },
    { key: "type", title: "知识类型", render: (row) => <KnowledgeTypeBadge type={row.type} /> },
    { key: "date", title: "有效期", render: (row) => row.validUntil },
    { key: "days", title: "距到期天数", render: (row) => <span className={row.daysLeft < 0 ? "font-semibold text-red-600" : "text-slate-700"}>{row.daysLeft}</span> },
    { key: "updated", title: "最近更新", render: (row) => row.lastUpdated },
    { key: "owner", title: "责任人", render: (row) => row.owner },
    { key: "status", title: "状态", render: (row) => <StatusBadge status={row.status} /> },
    {
      key: "op",
      title: "操作",
      render: (row) => (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => addToast({ title: "已发起复审", description: row.title, type: "success" })}>发起复审</Button>
          <Button size="sm" variant="outline" onClick={() => addToast({ title: "已延期", description: row.title, type: "success" })}>延期</Button>
          <Button size="sm" variant="outline" onClick={() => addToast({ title: "已下架", description: row.title, type: "warning" })}>下架</Button>
          <Button size="sm" variant="outline" onClick={() => addToast({ title: "已打开知识详情", description: row.title })}>查看详情</Button>
        </div>
      )
    }
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="复审下架"
        description="管理即将到期、已过期、长期未更新知识，避免旧知识继续影响搜索和问答结果。"
        actions={
          <>
            <Button variant="outline" onClick={() => addToast({ title: "已批量延期", type: "success" })}>
              <RefreshCw className="h-4 w-4" />
              批量延期
            </Button>
            <Button variant="outline" onClick={() => addToast({ title: "已发起复审", type: "success" })}>
              <CalendarClock className="h-4 w-4" />
              发起复审
            </Button>
            <Button onClick={() => addToast({ title: "已批量下架", type: "warning" })}>
              <Archive className="h-4 w-4" />
              批量下架
            </Button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="即将到期" value={6} description="建议提前复审" icon={<CalendarClock className="h-5 w-5 text-amber-500" />} />
        <MetricCard title="已过期" value={3} description="需要延期或下架" icon={<Clock3 className="h-5 w-5 text-red-500" />} />
        <MetricCard title="长期未更新" value={12} description="建议确认是否仍有效" icon={<RefreshCw className="h-5 w-5 text-indigo-500" />} />
        <MetricCard title="已下架" value={5} description="不再参与搜索问答" icon={<Archive className="h-5 w-5 text-slate-500" />} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {categories.map((item) => <TabsTrigger key={item} value={item}>{item}</TabsTrigger>)}
        </TabsList>
        <TabsContent value={tab}>
          <SectionCard title={`${tab}知识`} description="按有效期和更新状态推动复审、延期或下架。">
            <DataTable columns={columns} data={data} rowKey={(row) => row.id} />
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}
