import { Bell, Command, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function Header() {
  return (
    <header className="sticky top-0 z-30 flex h-20 items-center justify-between border-b bg-white/[0.82] px-8 backdrop-blur">
      <div className="relative w-[460px] max-w-[52vw]">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input className="h-11 rounded-2xl bg-slate-50 pl-10 pr-20" placeholder="搜索知识..." />
        <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-lg border bg-white px-2 py-1 text-xs text-slate-400">
          <Command className="h-3 w-3" />
          K
        </div>
      </div>
      <div className="flex items-center gap-4">
        <button className="relative rounded-2xl border bg-white p-2.5 text-slate-500 shadow-sm transition hover:bg-slate-50">
          <Bell className="h-5 w-5" />
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-amber-400" />
        </button>
        <div className="flex items-center gap-3 rounded-2xl border bg-white px-3 py-2 shadow-sm">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-cyan-400 text-sm font-semibold text-white">
            强
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-slate-900">王强</p>
            <p className="text-xs text-slate-500">企业管理员</p>
          </div>
        </div>
      </div>
    </header>
  );
}
