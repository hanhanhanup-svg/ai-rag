import { ArrowRight, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CurrentUser } from "@/auth/roles";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface RoleLoginCardProps {
  user: CurrentUser;
  description: string;
  tag: string;
  icon: LucideIcon;
  tone: "indigo" | "blue" | "green";
  loading?: boolean;
  onLogin: () => void;
}

const toneClass = {
  indigo: {
    avatar: "from-indigo-500 to-violet-500",
    badge: "bg-indigo-50 text-indigo-700",
    ring: "hover:border-indigo-200 hover:shadow-glow"
  },
  blue: {
    avatar: "from-blue-500 to-cyan-400",
    badge: "bg-blue-50 text-blue-700",
    ring: "hover:border-blue-200 hover:shadow-[0_16px_45px_rgba(59,130,246,0.16)]"
  },
  green: {
    avatar: "from-emerald-500 to-teal-400",
    badge: "bg-emerald-50 text-emerald-700",
    ring: "hover:border-emerald-200 hover:shadow-[0_16px_45px_rgba(16,185,129,0.16)]"
  }
};

export function RoleLoginCard({ user, description, tag, icon: Icon, tone, loading, onLogin }: RoleLoginCardProps) {
  const style = toneClass[tone];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onLogin}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onLogin();
      }}
      className={cn(
        "group flex h-full flex-col rounded-2xl border border-slate-200/80 bg-white p-4 text-left shadow-sm transition hover:-translate-y-1",
        style.ring
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-sm", style.avatar)}>
          <Icon className="h-5 w-5" />
        </div>
        <Badge className={cn("border-transparent", style.badge)}>{tag}</Badge>
      </div>
      <div className="mt-4 min-h-[112px]">
        <p className="font-semibold text-slate-950">{user.roleName}</p>
        <p className="mt-1 text-sm text-slate-500">{user.name} · {user.username}</p>
        <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
      </div>
      <Button className="mt-auto w-full" disabled={loading} onClick={(event) => {
        event.stopPropagation();
        onLogin();
      }}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
        进入演示
      </Button>
    </div>
  );
}
