import { Bell, CheckCircle2, UploadCloud } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { notifications } from "@/data/mock/workspace";

export default function ActivityPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="运营动态" description="查看近期上传、审核通过、质量扫描、应用调用和安全提醒。" />
      <SectionCard title="动态时间线" description="帮助管理员理解平台最近发生了什么。">
        <div className="space-y-4">
          {notifications.map((notice, index) => (
            <div key={notice.id} className="flex gap-4 rounded-3xl border bg-white p-5 shadow-sm">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                {index % 3 === 0 ? <Bell className="h-5 w-5" /> : index % 3 === 1 ? <UploadCloud className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-slate-950">{notice.title}</p>
                  <StatusBadge status={notice.read ? "已读" : "未读"} tone={notice.read ? "muted" : "normal"} />
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">{notice.content}</p>
                <p className="mt-2 text-xs text-slate-400">{notice.time} · {notice.type}</p>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
