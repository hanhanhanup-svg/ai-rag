import { useMemo, useState } from "react";
import { BarChart3, Building2, FolderOpen, Import, Plus, Settings, UserRound } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { SensitivityBadge } from "@/components/common/SensitivityBadge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/common/Tabs";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import { useAuthStore } from "@/auth/authStore";
import { filterKnowledgeBasesByRole } from "@/lib/roleDataFilter";
import type { KnowledgeBase, SensitivityLevel } from "@/types";

const colorOptions: KnowledgeBase["color"][] = ["blue", "purple", "green", "orange", "red"];
const colorClass: Record<KnowledgeBase["color"], string> = {
  blue: "from-blue-500 to-cyan-400",
  purple: "from-indigo-500 to-violet-500",
  green: "from-emerald-500 to-teal-400",
  orange: "from-amber-500 to-orange-500",
  red: "from-rose-500 to-red-500"
};

function KnowledgeBaseCard({ item }: { item: KnowledgeBase }) {
  const Icon = item.type === "个人" ? UserRound : item.type === "部门" ? Building2 : FolderOpen;

  return (
    <div className="knowledge-card rounded-2xl border bg-white p-5 shadow-soft transition hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br text-white", colorClass[item.color])}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold text-slate-950">{item.name}</p>
            <p className="mt-1 text-xs text-slate-500">{item.owner} · 创建于 {item.createdAt}</p>
          </div>
        </div>
        <StatusBadge status={item.status} />
      </div>
      <p className="mt-4 line-clamp-2 text-sm leading-6 text-slate-500">{item.description}</p>
      <div className="mt-5 grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-xs text-slate-500">知识条目</p>
          <p className="mt-1 text-lg font-semibold">{item.itemCount}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-xs text-slate-500">待审核</p>
          <p className="mt-1 text-lg font-semibold">{item.pendingReview}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-xs text-slate-500">质量分</p>
          <p className="mt-1 text-lg font-semibold">{item.qualityScore ?? "—"}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <SensitivityBadge level={item.sensitivity} />
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm"><FolderOpen className="h-4 w-4" />打开</Button>
          <Button variant="ghost" size="icon" title="统计"><BarChart3 className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" title="设置"><Settings className="h-4 w-4" /></Button>
        </div>
      </div>
    </div>
  );
}

export default function KnowledgeBasesPage() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    color: "blue" as KnowledgeBase["color"],
    type: "个人" as KnowledgeBase["type"],
    sensitivity: "内部" as SensitivityLevel,
    description: ""
  });
  const knowledgeBases = useAppStore((state) => state.knowledgeBases);
  const addKnowledgeBase = useAppStore((state) => state.addKnowledgeBase);
  const addToast = useAppStore((state) => state.addToast);
  const currentUser = useAuthStore((state) => state.currentUser);
  const visibleKnowledgeBases = useMemo(
    () => filterKnowledgeBasesByRole(currentUser, knowledgeBases),
    [currentUser, knowledgeBases]
  );

  const grouped = useMemo(
    () => ({
      个人: visibleKnowledgeBases.filter((item) => item.type === "个人"),
      部门: visibleKnowledgeBases.filter((item) => item.type === "部门"),
      企业: visibleKnowledgeBases.filter((item) => item.type === "企业"),
      平台: visibleKnowledgeBases.filter((item) => item.type === "平台")
    }),
    [visibleKnowledgeBases]
  );

  const createKnowledgeBase = () => {
    const item: KnowledgeBase = {
      id: `kb-${Date.now()}`,
      name: form.name || "新建知识库",
      type: form.type,
      owner: currentUser?.name ?? "王强",
      createdAt: "2026-05-21",
      itemCount: 0,
      monthlyNew: 0,
      pendingReview: 0,
      status: "正常",
      color: form.color,
      sensitivity: form.sensitivity,
      description: form.description || "用于沉淀团队知识、流程和经验。"
    };
    addKnowledgeBase(item);
    setOpen(false);
    setForm({ name: "", color: "blue", type: "个人", sensitivity: "内部", description: "" });
    addToast({ title: "知识库创建成功", description: `${item.name} 已加入私有知识库列表。`, type: "success" });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="知识库"
        description="私有知识库（个人 / 部门 / 企业）与平台知识库统一管理。"
        actions={
          <>
            <Button variant="outline"><Import className="h-4 w-4" />导入知识库包</Button>
            <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />新建知识库</Button>
          </>
        }
      />

      <Tabs defaultValue="private">
        <TabsList>
          <TabsTrigger value="private">私有知识库</TabsTrigger>
          <TabsTrigger value="platform">平台知识库</TabsTrigger>
        </TabsList>
        <TabsContent value="private" className="space-y-6">
          {[
            { key: "个人", title: "个人知识库", desc: "仅自己可见，可选择共享" },
            { key: "部门", title: "部门知识库", desc: "部门成员可访问" },
            { key: "企业", title: "企业知识库", desc: "企业范围统一管理，按权限访问" }
          ].map((group) => (
            <SectionCard key={group.key} title={group.title} description={group.desc}>
              <div className="grid gap-4 xl:grid-cols-3 2xl:grid-cols-4">
                {grouped[group.key as "个人" | "部门" | "企业"].map((item) => (
                  <KnowledgeBaseCard key={item.id} item={item} />
                ))}
              </div>
            </SectionCard>
          ))}
        </TabsContent>
        <TabsContent value="platform">
          <SectionCard title="平台知识库" description="由平台统一维护的公共知识资产。">
            <div className="grid gap-4 xl:grid-cols-3">
              <div className="rounded-2xl border border-dashed bg-slate-50 p-8 text-center">
                <FolderOpen className="mx-auto h-8 w-8 text-slate-400" />
                <p className="mt-3 font-medium">暂无平台知识库</p>
                <p className="mt-2 text-sm text-slate-500">可在后续接入官方知识包、产品手册和统一制度库。</p>
              </div>
            </div>
          </SectionCard>
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建知识库</DialogTitle>
            <DialogDescription>创建一个新的知识空间，用于承载文件抽取、审核与治理流程。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <label className="space-y-2 text-sm font-medium">
              <span>知识库名称</span>
              <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：售前知识库" />
            </label>
            <div className="space-y-2">
              <p className="text-sm font-medium">图标颜色</p>
              <div className="flex gap-2">
                {colorOptions.map((color) => (
                  <button
                    key={color}
                    className={cn("h-9 w-9 rounded-xl bg-gradient-to-br ring-offset-2", colorClass[color], form.color === color && "ring-2 ring-indigo-500")}
                    onClick={() => setForm({ ...form, color })}
                  />
                ))}
              </div>
            </div>
            <label className="space-y-2 text-sm font-medium">
              <span>知识空间类型</span>
              <Select value={form.type} onValueChange={(value) => setForm({ ...form, type: value as KnowledgeBase["type"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="个人">个人知识库</SelectItem>
                  <SelectItem value="部门">部门知识库</SelectItem>
                  <SelectItem value="企业">企业知识库</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-2 text-sm font-medium">
              <span>默认密级</span>
              <Select value={form.sensitivity} onValueChange={(value) => setForm({ ...form, sensitivity: value as SensitivityLevel })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="公开">公开</SelectItem>
                  <SelectItem value="内部">内部</SelectItem>
                  <SelectItem value="机密">机密</SelectItem>
                  <SelectItem value="绝密">绝密</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-2 text-sm font-medium">
              <span>描述</span>
              <Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="描述这个知识库的业务范围" />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={createKnowledgeBase}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
