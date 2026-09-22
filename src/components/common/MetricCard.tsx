import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon?: ReactNode;
  className?: string;
}

export function MetricCard({ title, value, description, icon, className }: MetricCardProps) {
  return (
    <div className={cn("knowledge-card rounded-2xl border bg-white p-5 shadow-soft", className)}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">{title}</p>
        {icon}
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-normal text-slate-950">{value}</p>
      {description && <p className="mt-2 text-sm text-slate-500">{description}</p>}
    </div>
  );
}
