import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StatusTone } from "@/types";

const toneClasses: Record<StatusTone, string> = {
  normal: "from-indigo-50 to-white text-indigo-600",
  attention: "from-amber-50 to-white text-amber-600",
  success: "from-emerald-50 to-white text-emerald-600",
  warning: "from-orange-50 to-white text-orange-600",
  danger: "from-red-50 to-white text-red-600",
  muted: "from-slate-50 to-white text-slate-600"
};

interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  tone?: StatusTone;
}

export function StatCard({ label, value, hint, icon: Icon, tone = "normal" }: StatCardProps) {
  return (
    <div className={cn("knowledge-card rounded-2xl border bg-gradient-to-br p-5 shadow-soft", toneClasses[tone])}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-3 text-3xl font-semibold tracking-normal text-slate-950">{value}</p>
        </div>
        {Icon && (
          <div className="rounded-2xl bg-white p-2.5 shadow-sm">
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
      {hint && <p className="mt-4 text-sm font-medium">{hint}</p>}
    </div>
  );
}
