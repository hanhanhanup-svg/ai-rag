import { useMemo, useState } from "react";
import { Check, FileText, Send, UploadCloud } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { DataTable, type TableColumn } from "@/components/common/DataTable";
import { StatusBadge } from "@/components/common/StatusBadge";
import { ProgressBar } from "@/components/common/ProgressBar";
import { DetailDrawer } from "@/components/drawers/DetailDrawer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/common/Tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { extractedPreview, uploadSkills } from "@/data/mock/uploadTasks";
import { useAppStore } from "@/store/useAppStore";
import type { UploadTask } from "@/types";
import { cn } from "@/lib/utils";

const steps = ["选择文件", "选择抽取技能", "选择目标知识类型与配置", "提交任务"];
const formats = ["PDF", "Word", "Excel", "PPT", "TXT", "图片", "音视频", "ZIP"];
const knowledgeTypes = ["FAQ", "SOP", "text_chunk", "实体", "政策", "合同", "合规"];

export default function UploadPage() {
  const [step, setStep] = useState(0);
  const [selectedSkill, setSelectedSkill] = useState("员工手册 FAQ 抽取");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("全部");
  const [config, setConfig] = useState({
    knowledgeBase: "测试知识库",
    type: "FAQ",
    sensitivity: "内部",
    autoTag: true,
    review: true,
    summary: true,
    variants: true
  });
  const tasks = useAppStore((state) => state.uploadTasks);
  const addUploadTask = useAppStore((state) => state.addUploadTask);
  const addToast = useAppStore((state) => state.addToast);

  const filteredTasks = useMemo(
    () => tasks.filter((task) => statusFilter === "全部" || task.status === statusFilter),
    [tasks, statusFilter]
  );

  const submitTask = () => {
    const task: UploadTask = {
      id: `upload-${Date.now()}`,
      fileName: "员工手册补充说明.pdf",
      size: "520.6KB",
      pages: 9,
      skill: selectedSkill,
      stage: "解析中",
      progress: 18,
      extractedCount: 0,
      status: "解析中"
    };
    addUploadTask(task);
    addToast({ title: "处理任务已提交", description: "系统正在解析文件并生成候选知识。", type: "success" });
    setStep(0);
  };

  const columns: TableColumn<UploadTask>[] = [
    { key: "file", title: "文件名", render: (row) => <span className="font-medium text-slate-900">{row.fileName}</span> },
    { key: "size", title: "大小", render: (row) => row.size },
    { key: "pages", title: "页数", render: (row) => `${row.pages}页` },
    { key: "skill", title: "技能", render: (row) => row.skill },
    { key: "stage", title: "处理阶段", render: (row) => row.stage },
    { key: "progress", title: "进度", render: (row) => <div className="w-32"><ProgressBar value={row.progress} /></div> },
    { key: "count", title: "抽取条数", render: (row) => `${row.extractedCount}条` },
    { key: "status", title: "状态", render: (row) => <StatusBadge status={row.status} /> },
    { key: "op", title: "操作", render: (row) => <Button size="sm" variant="outline" onClick={() => setDrawerOpen(true)}>{row.status === "待审核" ? "查看结果" : "详情"}</Button> }
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="文件上传" description="上传资料 → 自动整理 → 审核入库，把文件变成可搜索、可问答的可信知识。" />

      <SectionCard>
        <div className="grid gap-3 md:grid-cols-4">
          {steps.map((item, index) => (
            <button
              key={item}
              onClick={() => setStep(index)}
              className={cn(
                "flex items-center gap-3 rounded-2xl border p-4 text-left transition",
                step === index ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "bg-white hover:bg-slate-50"
              )}
            >
              <span className={cn("flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold", index <= step ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500")}>
                {index < step ? <Check className="h-4 w-4" /> : index + 1}
              </span>
              <span className="font-medium">{item}</span>
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard title={steps[step]} description="按步骤配置文件处理方式，确认后提交异步处理任务。">
        {step === 0 && (
          <div>
            <div className="flex min-h-[260px] flex-col items-center justify-center rounded-3xl border-2 border-dashed border-indigo-200 bg-indigo-50/50 p-10 text-center">
              <div className="rounded-3xl bg-white p-4 text-indigo-600 shadow-soft">
                <UploadCloud className="h-10 w-10" />
              </div>
              <p className="mt-5 text-lg font-semibold">拖拽文件到此处，或点击选择文件</p>
              <p className="mt-2 text-sm text-slate-500">单文件最大 500MB，批量最多 100 个文件</p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {formats.map((format) => <Badge key={format} variant="outline">{format}</Badge>)}
              </div>
              <Button className="mt-6" onClick={() => setStep(1)}>选择示例文件</Button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {uploadSkills.map((skill) => (
              <button
                key={skill}
                onClick={() => setSelectedSkill(skill)}
                className={cn("rounded-2xl border bg-white p-5 text-left transition hover:border-indigo-200 hover:bg-indigo-50/40", selectedSkill === skill && "border-indigo-300 bg-indigo-50")}
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-indigo-100 p-3 text-indigo-600"><FileText className="h-5 w-5" /></div>
                  <div>
                    <p className="font-semibold text-slate-950">{skill}</p>
                    <p className="mt-1 text-sm text-slate-500">适配文档解析、知识切片和审核入库。</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-5 lg:grid-cols-2">
            <label className="space-y-2 text-sm font-medium">
              <span>目标知识库</span>
              <Select value={config.knowledgeBase} onValueChange={(value) => setConfig({ ...config, knowledgeBase: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="测试知识库">测试知识库</SelectItem>
                  <SelectItem value="公司规章制度知识库">公司规章制度知识库</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-2 text-sm font-medium">
              <span>目标知识类型</span>
              <Select value={config.type} onValueChange={(value) => setConfig({ ...config, type: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {knowledgeTypes.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-2 text-sm font-medium">
              <span>默认密级</span>
              <Select value={config.sensitivity} onValueChange={(value) => setConfig({ ...config, sensitivity: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["公开", "内部", "机密", "绝密"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <div className="grid gap-3 rounded-2xl bg-slate-50 p-4">
              {[
                ["是否自动打标", "autoTag"],
                ["是否进入审核", "review"],
                ["是否生成摘要", "summary"],
                ["是否生成问题变体", "variants"]
              ].map(([label, key]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-sm font-medium">{label}</span>
                  <Switch checked={config[key as keyof typeof config] as boolean} onCheckedChange={(checked) => setConfig({ ...config, [key]: checked })} />
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="rounded-2xl border bg-slate-50 p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <p><span className="text-slate-500">文件：</span>深演智能员工手册-2025版.pdf</p>
              <p><span className="text-slate-500">抽取技能：</span>{selectedSkill}</p>
              <p><span className="text-slate-500">目标知识库：</span>{config.knowledgeBase}</p>
              <p><span className="text-slate-500">目标类型：</span>{config.type}</p>
              <p><span className="text-slate-500">默认密级：</span>{config.sensitivity}</p>
              <p><span className="text-slate-500">审核策略：</span>{config.review ? "进入审核" : "直接入库"}</p>
            </div>
            <Button className="mt-6" onClick={submitTask}><Send className="h-4 w-4" />提交任务</Button>
          </div>
        )}

        <div className="mt-6 flex justify-between">
          <Button variant="outline" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>上一步</Button>
          <Button disabled={step === 3} onClick={() => setStep((value) => Math.min(3, value + 1))}>下一步</Button>
        </div>
      </SectionCard>

      <SectionCard title="处理任务列表" description="展示文件解析、抽取生成和审核入库状态。">
        <Tabs value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList>
            {["全部", "解析中", "待审核", "已完成", "失败"].map((status) => <TabsTrigger key={status} value={status}>{status}</TabsTrigger>)}
          </TabsList>
          <TabsContent value={statusFilter}>
            <DataTable columns={columns} data={filteredTasks} rowKey={(row) => row.id} />
          </TabsContent>
        </Tabs>
      </SectionCard>

      <DetailDrawer open={drawerOpen} onOpenChange={setDrawerOpen} title="抽取结果预览" description="候选知识进入审核前，可先查看抽取类型、标题和置信度。">
        <div className="space-y-3">
          {extractedPreview.map((item) => (
            <div key={item.title} className="rounded-2xl border bg-slate-50 p-4">
              <div className="flex items-center justify-between">
                <Badge variant={item.type === "FAQ" ? "default" : "success"}>{item.type}</Badge>
                <span className="text-sm font-medium text-indigo-600">{item.confidence}</span>
              </div>
              <p className="mt-3 font-medium text-slate-900">{item.title}</p>
              <p className="mt-2 text-sm text-slate-500">来源：深演智能员工手册-2025版.pdf · 待审核</p>
            </div>
          ))}
        </div>
      </DetailDrawer>
    </div>
  );
}
