import { CheckCircle2, Crown, Megaphone, UsersRound } from "lucide-react";
import { DEMO_USERS } from "@/auth/roles";
import { useAuthStore } from "@/auth/authStore";
import { useAppStore } from "@/store/useAppStore";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface SwitchRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const roleIcons = {
  u_super: Crown,
  u_marketing: Megaphone,
  u_hr: UsersRound
};

export function SwitchRoleDialog({ open, onOpenChange }: SwitchRoleDialogProps) {
  const currentUser = useAuthStore((state) => state.currentUser);
  const switchRole = useAuthStore((state) => state.switchRole);
  const addToast = useAppStore((state) => state.addToast);

  const handleSwitch = (userId: string) => {
    const user = switchRole(userId);
    if (!user) return;
    addToast({ title: `已切换为 ${user.roleName}`, description: `${user.name} · ${user.businessDomain}`, type: "success" });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl rounded-3xl p-7">
        <DialogHeader>
          <DialogTitle className="text-xl">切换演示身份</DialogTitle>
          <DialogDescription>无需重新输入账号密码，选择身份后当前页面会按角色权限刷新数据。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-3">
          {DEMO_USERS.map((user) => {
            const Icon = roleIcons[user.id as keyof typeof roleIcons];
            const active = currentUser?.id === user.id;

            return (
              <button
                key={user.id}
                onClick={() => handleSwitch(user.id)}
                className={cn(
                  "group rounded-2xl border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-glow",
                  active && "border-indigo-300 bg-indigo-50/70"
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white">
                    <Icon className="h-5 w-5" />
                  </div>
                  {active && <CheckCircle2 className="h-5 w-5 text-indigo-600" />}
                </div>
                <p className="mt-4 font-semibold text-slate-950">{user.roleName}</p>
                <p className="mt-1 text-sm text-slate-500">{user.name}</p>
                <p className="mt-3 text-xs leading-5 text-slate-500">{user.businessDomain} · 最高密级 {user.maxSensitivityLevel}</p>
              </button>
            );
          })}
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
