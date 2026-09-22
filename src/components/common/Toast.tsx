import { CheckCircle2, Info, X } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

export function ToastViewport() {
  const toasts = useAppStore((state) => state.toasts);
  const dismissToast = useAppStore((state) => state.dismissToast);

  return (
    <div className="fixed right-5 top-5 z-[80] flex w-[340px] flex-col gap-3">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "flex items-start gap-3 rounded-2xl border bg-white p-4 shadow-soft",
            toast.type === "success" && "border-emerald-100",
            toast.type === "warning" && "border-amber-100"
          )}
        >
          {toast.type === "success" ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-500" />
          ) : (
            <Info className="mt-0.5 h-5 w-5 text-indigo-500" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900">{toast.title}</p>
            {toast.description && <p className="mt-1 text-xs text-slate-500">{toast.description}</p>}
          </div>
          <button className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" onClick={() => dismissToast(toast.id)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
