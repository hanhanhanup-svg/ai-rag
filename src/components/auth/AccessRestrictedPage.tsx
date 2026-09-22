import { useState } from "react";
import { ArrowLeft, ShieldCheck, UsersRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { SwitchRoleDialog } from "@/components/auth/SwitchRoleDialog";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/auth/authStore";

export function AccessRestrictedPage() {
  const [switchOpen, setSwitchOpen] = useState(false);
  const currentUser = useAuthStore((state) => state.currentUser);
  const navigate = useNavigate();

  return (
    <section className="mx-auto mt-20 max-w-2xl rounded-3xl border border-white/80 bg-white p-8 text-center shadow-soft">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-indigo-50 text-indigo-600">
        <ShieldCheck className="h-8 w-8" />
      </div>
      <h2 className="mt-5 text-2xl font-semibold tracking-normal text-slate-950">当前身份暂未开通该功能权限</h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-slate-500">
        你当前登录身份为：{currentUser?.roleName ?? "演示用户"}。该功能属于平台级管理能力，仅超级管理员可访问。
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Button variant="outline" onClick={() => navigate("/workspace/overview")}>
          <ArrowLeft className="h-4 w-4" />
          返回工作台
        </Button>
        <Button onClick={() => setSwitchOpen(true)}>
          <UsersRound className="h-4 w-4" />
          切换身份
        </Button>
      </div>
      <SwitchRoleDialog open={switchOpen} onOpenChange={setSwitchOpen} />
    </section>
  );
}
