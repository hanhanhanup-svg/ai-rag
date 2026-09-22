import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Download,
  Eye,
  FileSearch,
  ListChecks,
  Loader2,
  RotateCcw,
  ScrollText,
  XCircle
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/common/PageHeader";
import { MetricCard } from "@/components/common/MetricCard";
import { ProgressBar } from "@/components/common/ProgressBar";
import { SectionCard } from "@/components/common/SectionCard";
import { ConfirmDialog } from "@/components/dialogs/ConfirmDialog";
import { DetailDrawer } from "@/components/drawers/DetailDrawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

type TaskView = "current" | "history" | "errors" | "logs";
type TaskStatus = "解析中" | "提取完成" | "待审核" | "已完成" | "失败" | "已取消";

interface ExtractionTask {
  id: string;
  name: string;
  fileName: string;
  knowledgeBase: string;
  skill: string;
  stage: string;
  progress: number;
  extractedCount: number;
  status: TaskStatus;
  creator: string;
  createdAt: string;
  description: string;
  result: {
    faq: number;
    sop: number;
    chunk: number;
    pendingReview: number;
    candidates: string[];
  };
}

interface HistoryRecord {
  id: string;
  fileName: string;
  method: string;
  stage: string;
  extractedCount: number;
  status: TaskStatus;
  runTime: string;
}

interface ErrorTask {
  id: string;
  name: string;
  fileName: string;
  stage: string;
  reason: string;
  impact: string;
  retryAt: string;
}

interface RunLog {
  id: string;
  time: string;
  taskName: string;
  node: string;
  action: string;
  result: string;
  cost: string;
  executor: string;
}

const stageNames = ["上传文件", "解析内容", "抽取知识", "生成候选", "审核入库"];

const currentTasks: ExtractionTask[] = [
  {
    id: "task-employee-handbook",
    name: "深演智能员工手册-2025版知识整理",
    fileName: "深演智能员工手册-2025版.pdf",
    knowledgeBase: "员工制度知识库",
    skill: "员工手册 FAQ 抽取",
    stage: "提取完成",
    progress: 100,
    extractedCount: 81,
    status: "待审核",
    creator: "王强",
    createdAt: "2026-05-21",
    description: "已从员工手册中生成 81 条候选知识，建议进入审核确认。",
    result: {
      faq: 68,
      sop: 13,
      chunk: 0,
      pendingReview: 78,
      candidates: ["员工加班申请流程", "一般违纪行为说明", "员工反馈沟通规范", "绩效申诉处理流程", "离职交接流程"]
    }
  },
  {
    id: "task-admin-process",
    name: "行政办公流程说明知识整理",
    fileName: "行政办公流程说明.docx",
    knowledgeBase: "公司规章制度知识库",
    skill: "Word 深度解析",
    stage: "知识构建",
    progress: 76,
    extractedCount: 18,
    status: "解析中",
    creator: "王强",
    createdAt: "2026-05-21",
    description: "正在构建行政流程候选知识，已识别审批、会议、资产申请等主题。",
    result: {
      faq: 8,
      sop: 7,
      chunk: 3,
      pendingReview: 0,
      candidates: ["会议室预约流程", "办公用品申请规范", "资产领用审批", "行政报销材料清单"]
    }
  },
  {
    id: "task-presales-faq",
    name: "售前常见问题整理知识整理",
    fileName: "售前常见问题整理.xlsx",
    knowledgeBase: "售前知识库",
    skill: "表格专项抽取",
    stage: "已入库",
    progress: 100,
    extractedCount: 32,
    status: "已完成",
    creator: "王强",
    createdAt: "2026-05-21",
    description: "售前问答已完成入库，可在售前知识库中检索和问答引用。",
    result: {
      faq: 29,
      sop: 1,
      chunk: 2,
      pendingReview: 0,
      candidates: ["售前客户常见问题", "产品能力介绍标准话术", "竞品对比说明", "客户异议处理流程"]
    }
  }
];

const historyRecords: HistoryRecord[] = [
  {
    id: "history-1",
    fileName: "深演智能员工手册-2025版.pdf",
    method: "员工手册 FAQ 抽取",
    stage: "提取完成",
    extractedCount: 81,
    status: "待审核",
    runTime: "2026-05-21 11:30"
  },
  {
    id: "history-2",
    fileName: "行政办公流程说明.docx",
    method: "Word 深度解析",
    stage: "知识构建",
    extractedCount: 18,
    status: "解析中",
    runTime: "2026-05-21 11:30"
  },
  {
    id: "history-3",
    fileName: "售前常见问题整理.xlsx",
    method: "表格专项抽取",
    stage: "已入库",
    extractedCount: 32,
    status: "已完成",
    runTime: "2026-05-21 11:30"
  }
];

const errorTasks: ErrorTask[] = [
  {
    id: "error-contract",
    name: "合同条款样例文件解析",
    fileName: "合同条款样例文件.pdf",
    stage: "表格识别",
    reason: "文件中存在扫描图片表格，未开启 OCR 表格识别",
    impact: "生成知识 0 条",
    retryAt: "2026-05-21 10:40"
  },
  {
    id: "error-product-manual",
    name: "产品手册图片版解析",
    fileName: "产品手册图片版.pdf",
    stage: "文本抽取",
    reason: "图片清晰度较低，OCR 置信度不足",
    impact: "低置信知识 6 条",
    retryAt: "2026-05-21 09:50"
  }
];

const runLogs: RunLog[] = [
  {
    id: "log-1",
    time: "2026-05-21 11:30",
    taskName: "深演智能员工手册-2025版知识整理",
    node: "文件解析",
    action: "解析 PDF 文本与页面结构",
    result: "成功",
    cost: "1.2s",
    executor: "系统"
  },
  {
    id: "log-2",
    time: "2026-05-21 11:31",
    taskName: "深演智能员工手册-2025版知识整理",
    node: "QA 生成",
    action: "基于文本块生成 FAQ 候选知识",
    result: "生成 68 条 FAQ",
    cost: "5.8s",
    executor: "AI 抽取服务"
  },
  {
    id: "log-3",
    time: "2026-05-21 11:33",
    taskName: "深演智能员工手册-2025版知识整理",
    node: "提交审核",
    action: "将候选知识提交至审核工作台",
    result: "待审核 78 条",
    cost: "0.4s",
    executor: "系统"
  }
];

const statusClass: Record<TaskStatus, string> = {
  解析中: "bg-blue-50 text-blue-700 border-blue-100",
  提取完成: "bg-violet-50 text-violet-700 border-violet-100",
  待审核: "bg-amber-50 text-amber-700 border-amber-100",
  已完成: "bg-emerald-50 text-emerald-700 border-emerald-100",
  失败: "bg-red-50 text-red-700 border-red-100",
  已取消: "bg-slate-100 text-slate-600 border-slate-200"
};

const viewItems: Array<{ key: TaskView; title: string; icon: typeof ListChecks }> = [
  { key: "current", title: "当前任务", icon: ListChecks },
  { key: "history", title: "历史记录", icon: Clock3 },
  { key: "errors", title: "异常任务", icon: AlertTriangle },
  { key: "logs", title: "运行日志", icon: ScrollText }
];

function StatusPill({ status }: { status: TaskStatus }) {
  return <span className={cn("inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium", statusClass[status])}>{status}</span>;
}

function StageRail({ progress }: { progress: number }) {
  const currentIndex = progress >= 100 ? 4 : progress >= 76 ? 3 : progress >= 45 ? 2 : progress >= 18 ? 1 : 0;

  return (
    <div className="min-w-[160px]">
      <ProgressBar value={progress} label="进度" />
      <div className="mt-2 flex items-center gap-1">
        {stageNames.map((stage, index) => (
          <span
            key={stage}
            title={stage}
            className={cn("h-1.5 flex-1 rounded-full", index <= currentIndex ? "bg-indigo-500" : "bg-slate-200")}
          />
        ))}
      </div>
    </div>
  );
}

function ResultSummary({ task }: { task: ExtractionTask }) {
  const items = [
    ["FAQ 数量", task.result.faq],
    ["SOP 数量", task.result.sop],
    ["text_chunk 数量", task.result.chunk],
    ["待审核数量", task.result.pendingReview]
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-slate-50 p-4">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
          </div>
        ))}
      </div>
      <SectionCard title="知识候选列表" description="展示本次任务生成的候选知识，审核通过后进入目标知识库。">
        <div className="space-y-2">
          {task.result.candidates.map((item, index) => (
            <div key={item} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
              <div className="flex items-center gap-3">
                <Badge variant={index % 3 === 0 ? "default" : index % 3 === 1 ? "success" : "secondary"}>
                  {index % 3 === 0 ? "FAQ" : index % 3 === 1 ? "SOP" : "text_chunk"}
                </Badge>
                <span className="text-sm font-medium text-slate-800">{item}</span>
              </div>
              <span className="text-xs text-slate-400">置信度 {92 - index * 3}%</span>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

function LogTimeline({ taskName }: { taskName?: string }) {
  const scopedLogs = taskName ? runLogs.filter((log) => log.taskName === taskName) : runLogs;
  const logs = scopedLogs.length > 0 ? scopedLogs : runLogs;

  return (
    <div className="space-y-4">
      {logs.map((log) => (
        <div key={log.id} className="relative rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-semibold text-slate-950">{log.node}</p>
            <Badge variant={log.result === "成功" ? "success" : "default"}>{log.result}</Badge>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">{log.action}</p>
          <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-3">
            <span>{log.time}</span>
            <span>耗时：{log.cost}</span>
            <span>执行方：{log.executor}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ProductionTasksPage() {
  const [activeView, setActiveView] = useState<TaskView>("current");
  const [resultTask, setResultTask] = useState<ExtractionTask | null>(null);
  const [logTaskName, setLogTaskName] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{ type: "retry" | "cancel"; task: ExtractionTask } | null>(null);
  const addToast = useAppStore((state) => state.addToast);
  const navigate = useNavigate();

  const confirmCopy = useMemo(() => {
    if (!confirmState) return null;
    if (confirmState.type === "retry") {
      return {
        title: "确认重新执行该抽取任务？",
        description: "重试后将重新解析文件并覆盖当前候选结果。",
        confirmText: "确认重试"
      };
    }
    return {
      title: "确认取消该任务？",
      description: "取消后不会影响已经入库的知识。",
      confirmText: "确认取消"
    };
  }, [confirmState]);

  const enterReview = (task: ExtractionTask) => {
    addToast({ title: "已进入该任务的审核列表", description: task.name, type: "success" });
    navigate("/review");
  };

  const showLogs = (taskName?: string) => {
    setLogTaskName(taskName ?? null);
  };

  const handleConfirm = () => {
    if (!confirmState) return;
    addToast({
      title: confirmState.type === "retry" ? "任务已重新进入队列" : "任务已取消",
      description: confirmState.task.name,
      type: confirmState.type === "retry" ? "success" : "warning"
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="抽取任务"
        description="查看资料从解析、抽取、生成知识到审核入库的全过程，任务进度和历史记录都可追踪。"
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="处理中任务" value={6} description="正在解析或生成知识" icon={<Loader2 className="h-5 w-5 text-blue-500" />} />
        <MetricCard title="待审核任务" value={18} description="已生成知识，等待审核确认" icon={<FileSearch className="h-5 w-5 text-amber-500" />} />
        <MetricCard title="今日完成" value={12} description="今日已完成入库或进入审核" icon={<CheckCircle2 className="h-5 w-5 text-emerald-500" />} />
        <MetricCard title="失败任务" value={2} description="需要重试或人工处理" icon={<AlertTriangle className="h-5 w-5 text-red-500" />} />
      </div>

      <section className="rounded-3xl border border-white/80 bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold text-slate-950">知识生产流程</h3>
            <p className="mt-1 text-sm text-slate-500">从文件进入平台，到候选知识进入审核或入库，每个节点都可追踪。</p>
          </div>
          <div className="flex min-w-[520px] max-w-full flex-1 items-center gap-2">
            {stageNames.map((stage, index) => (
              <div key={stage} className="flex flex-1 items-center gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-600">{index + 1}</div>
                <span className="whitespace-nowrap text-xs font-medium text-slate-500">{stage}</span>
                {index < stageNames.length - 1 && <div className="h-px flex-1 bg-slate-200" />}
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="rounded-3xl border bg-white p-2 shadow-soft">
        <div className="flex flex-wrap gap-2">
          {viewItems.map((item) => (
            <button
              key={item.key}
              onClick={() => setActiveView(item.key)}
              className={cn(
                "flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-indigo-50 hover:text-indigo-700",
                activeView === item.key && "bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-glow hover:text-white"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.title}
            </button>
          ))}
        </div>
      </div>

      {activeView === "current" && (
        <SectionCard title="当前任务" description="展示正在处理或刚完成的任务，可查看结果、重试、取消或进入审核。">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1740px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  {[
                    ["任务名称", "min-w-[180px] w-[230px]"],
                    ["来源文件", "min-w-[180px] w-[210px]"],
                    ["目标知识库", "min-w-[140px] w-[160px]"],
                    ["抽取技能", "min-w-[150px] w-[170px]"],
                    ["当前阶段", "min-w-[120px] w-[130px]"],
                    ["进度", "min-w-[160px] w-[180px]"],
                    ["生成知识数", "min-w-[110px] w-[120px]"],
                    ["状态", "min-w-[100px] w-[110px]"],
                    ["创建人", "min-w-[90px] w-[90px]"],
                    ["创建时间", "min-w-[130px] w-[130px]"],
                    ["操作", "min-w-[260px] w-[300px]"]
                  ].map(([title, width]) => (
                    <th key={title} className={cn("whitespace-nowrap px-4 py-3 text-left font-semibold align-middle", width)}>
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {currentTasks.map((task) => (
                  <tr key={task.id} className="align-middle transition hover:bg-indigo-50/30">
                    <td className="px-4 py-4">
                      <p title={task.name} className="max-w-[220px] truncate font-semibold text-slate-950">{task.name}</p>
                      <p className="mt-1 max-w-[220px] truncate text-xs text-slate-500" title={task.description}>{task.description}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4">
                      <span title={task.fileName} className="block max-w-[190px] truncate">{task.fileName}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4">{task.knowledgeBase}</td>
                    <td className="whitespace-nowrap px-4 py-4">{task.skill}</td>
                    <td className="whitespace-nowrap px-4 py-4">{task.stage}</td>
                    <td className="px-4 py-4"><StageRail progress={task.progress} /></td>
                    <td className="whitespace-nowrap px-4 py-4 font-semibold text-slate-900">{task.extractedCount}</td>
                    <td className="whitespace-nowrap px-4 py-4"><StatusPill status={task.status} /></td>
                    <td className="whitespace-nowrap px-4 py-4">{task.creator}</td>
                    <td className="whitespace-nowrap px-4 py-4">{task.createdAt}</td>
                    <td className="px-4 py-4">
                      <div className="flex min-w-[260px] flex-nowrap items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => setResultTask(task)}>
                          <Eye className="h-4 w-4" />
                          {task.status === "解析中" ? "查看进度" : "查看结果"}
                        </Button>
                        {task.status === "已完成" ? (
                          <Button size="sm" variant="outline" onClick={() => addToast({ title: "已打开知识列表", description: task.knowledgeBase })}>
                            查看知识
                          </Button>
                        ) : (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setConfirmState({ type: "retry", task })}>
                              <RotateCcw className="h-4 w-4" />
                              重试
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setConfirmState({ type: "cancel", task })}>
                              <XCircle className="h-4 w-4" />
                              取消
                            </Button>
                          </>
                        )}
                        {task.status === "待审核" && (
                          <Button size="sm" onClick={() => enterReview(task)}>
                            进入审核
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {activeView === "history" && (
        <SectionCard title="历史运行记录" description="查看文件处理和知识生成的历史记录，便于追溯处理过程。">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  {["任务 / 文件", "处理方式", "处理阶段", "生成知识", "状态", "运行时间", "操作"].map((title) => (
                    <th key={title} className="whitespace-nowrap px-4 py-3 text-left font-semibold align-middle">{title}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {historyRecords.map((record) => (
                  <tr key={record.id} className="hover:bg-indigo-50/30">
                    <td className="whitespace-nowrap px-4 py-4 font-medium text-slate-950">
                      <span className="block max-w-[260px] truncate" title={record.fileName}>{record.fileName}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4">{record.method}</td>
                    <td className="whitespace-nowrap px-4 py-4">{record.stage}</td>
                    <td className="whitespace-nowrap px-4 py-4">{record.extractedCount} 条</td>
                    <td className="whitespace-nowrap px-4 py-4"><StatusPill status={record.status} /></td>
                    <td className="whitespace-nowrap px-4 py-4">{record.runTime}</td>
                    <td className="whitespace-nowrap px-4 py-4">
                      <Button size="sm" variant="outline" onClick={() => showLogs(record.fileName.replace(/\..+$/, "知识整理"))}>查看日志</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {activeView === "errors" && (
        <SectionCard title="异常任务" description="承接失败、取消、解析异常等情况，便于重试或人工处理。">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1160px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  {["任务名称", "文件名称", "异常阶段", "异常原因", "影响范围", "最近重试时间", "操作"].map((title) => (
                    <th key={title} className="whitespace-nowrap px-4 py-3 text-left font-semibold align-middle">{title}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {errorTasks.map((task, index) => (
                  <tr key={task.id} className="hover:bg-red-50/20">
                    <td className="whitespace-nowrap px-4 py-4 font-medium text-slate-950">{task.name}</td>
                    <td className="whitespace-nowrap px-4 py-4">{task.fileName}</td>
                    <td className="whitespace-nowrap px-4 py-4"><Badge variant="danger">{task.stage}</Badge></td>
                    <td className="px-4 py-4"><span className="block max-w-[320px] truncate" title={task.reason}>{task.reason}</span></td>
                    <td className="whitespace-nowrap px-4 py-4">{task.impact}</td>
                    <td className="whitespace-nowrap px-4 py-4">{task.retryAt}</td>
                    <td className="whitespace-nowrap px-4 py-4">
                      <div className="flex flex-nowrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => addToast({ title: index === 0 ? "已开启 OCR 并重新进入队列" : "请上传高清文件后重试", type: index === 0 ? "success" : "info" })}>
                          {index === 0 ? "开启 OCR 后重试" : "重新上传高清文件"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => showLogs(task.name)}>查看日志</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {activeView === "logs" && (
        <SectionCard title="运行日志" description="记录任务从上传、解析、抽取、生成知识到入库的关键节点。">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  {["时间", "任务名称", "节点", "动作", "结果", "耗时", "执行方"].map((title) => (
                    <th key={title} className="whitespace-nowrap px-4 py-3 text-left font-semibold align-middle">{title}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-indigo-50/30">
                    <td className="whitespace-nowrap px-4 py-4">{log.time}</td>
                    <td className="whitespace-nowrap px-4 py-4 font-medium text-slate-950">{log.taskName}</td>
                    <td className="whitespace-nowrap px-4 py-4">{log.node}</td>
                    <td className="px-4 py-4"><span className="block max-w-[300px] truncate" title={log.action}>{log.action}</span></td>
                    <td className="whitespace-nowrap px-4 py-4"><Badge variant="success">{log.result}</Badge></td>
                    <td className="whitespace-nowrap px-4 py-4">{log.cost}</td>
                    <td className="whitespace-nowrap px-4 py-4">{log.executor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      <DetailDrawer
        open={Boolean(resultTask)}
        onOpenChange={(open) => !open && setResultTask(null)}
        title={resultTask?.name ?? "任务结果"}
        description="查看该任务生成的候选知识与审核状态。"
        widthClassName="w-[780px]"
        footer={
          resultTask && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => addToast({ title: "结果已导出", description: resultTask.name, type: "success" })}>
                <Download className="h-4 w-4" />
                导出结果
              </Button>
              <Button variant="outline" onClick={() => setResultTask(null)}>关闭</Button>
              <Button onClick={() => enterReview(resultTask)}>
                进入审核
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )
        }
      >
        {resultTask && <ResultSummary task={resultTask} />}
      </DetailDrawer>

      <DetailDrawer
        open={logTaskName !== null}
        onOpenChange={(open) => !open && setLogTaskName(null)}
        title="任务运行日志"
        description={logTaskName ? `任务：${logTaskName}` : "查看任务运行时间线。"}
        widthClassName="w-[720px]"
      >
        <LogTimeline taskName={logTaskName ?? undefined} />
      </DetailDrawer>

      {confirmCopy && confirmState && (
        <ConfirmDialog
          open={Boolean(confirmState)}
          onOpenChange={(open) => !open && setConfirmState(null)}
          title={confirmCopy.title}
          description={confirmCopy.description}
          confirmText={confirmCopy.confirmText}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );
}
