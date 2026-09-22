import { Progress } from "@/components/ui/progress";

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{label ?? "进度"}</span>
        <span>{value}%</span>
      </div>
      <Progress value={value} />
    </div>
  );
}
