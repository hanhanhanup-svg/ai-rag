import { FormEvent, type CSSProperties, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2, Crown, LockKeyhole, Mail, Megaphone, Sparkles, UsersRound, Waves } from "lucide-react";
import { KnowledgeOceanBackground } from "@/components/auth/KnowledgeOceanBackground";
import { RoleLoginCard } from "@/components/auth/RoleLoginCard";
import { ToastViewport } from "@/components/common/Toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DEMO_USERS } from "@/auth/roles";
import { useAuthStore } from "@/auth/authStore";
import { useAppStore } from "@/store/useAppStore";

const defaultRedirect = "/workspace/overview";

const roleMeta = {
  u_super: {
    description: "查看全部功能、全部知识库、全部业务数据与系统配置。",
    tag: "全局权限",
    icon: Crown,
    tone: "indigo" as const
  },
  u_marketing: {
    description: "仅查看营销知识、售前资料、客户问答与营销质量任务。",
    tag: "营销业务域",
    icon: Megaphone,
    tone: "blue" as const
  },
  u_hr: {
    description: "仅查看员工制度、人事流程、考勤加班与人资知识问答。",
    tag: "人资业务域",
    icon: UsersRound,
    tone: "green" as const
  }
};

const gatherWords = [
  { text: "可信来源", left: "18%", top: "34%", x: "64px", y: "28px" },
  { text: "知识图谱", left: "76%", top: "28%", x: "-70px", y: "34px" },
  { text: "权限安全", left: "15%", top: "65%", x: "72px", y: "-38px" },
  { text: "质量治理", left: "78%", top: "66%", x: "-78px", y: "-34px" },
  { text: "流程", left: "31%", top: "20%", x: "34px", y: "58px" },
  { text: "问答", left: "63%", top: "19%", x: "-38px", y: "60px" }
];

const roleComparison = [
  {
    role: "超级管理员",
    items: ["全部功能模块", "全部知识库", "全部业务数据与系统配置"]
  },
  {
    role: "营销业务管理员",
    items: ["营销相关功能", "营销知识、售前资料、客户问答", "营销业务数据范围"]
  },
  {
    role: "人资业务管理员",
    items: ["人资相关功能", "员工制度、人事流程、考勤加班", "人资业务数据范围"]
  }
];

export default function LoginPage() {
  const [loadingRole, setLoadingRole] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const currentUser = useAuthStore((state) => state.currentUser);
  const loginAsUser = useAuthStore((state) => state.loginAsUser);
  const loginWithPassword = useAuthStore((state) => state.loginWithPassword);
  const addToast = useAppStore((state) => state.addToast);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? defaultRedirect;

  const completeLogin = (userId: string) => {
    setLoadingRole(userId);
    window.setTimeout(() => {
      const user = loginAsUser(userId);
      setLoadingRole(null);
      if (!user) return;
      addToast({ title: `欢迎回来，${user.name}`, description: `${user.roleName} · ${user.businessDomain}`, type: "success" });
      navigate(from === "/login" ? defaultRedirect : from, { replace: true });
    }, 500);
  };

  const submitPasswordLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const user = loginWithPassword(username, password);
    if (!user) {
      addToast({ title: "账号或密码不正确，请使用演示账号登录。", type: "warning" });
      return;
    }
    addToast({ title: `欢迎回来，${user.name}`, description: remember ? "已保持当前演示身份。" : undefined, type: "success" });
    navigate(from === "/login" ? defaultRedirect : from, { replace: true });
  };

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-8 text-slate-950">
      <KnowledgeOceanBackground />
      <main className="relative z-10 mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl flex-col items-center justify-center gap-6">
        <section className="relative text-center">
          {gatherWords.map((word) => (
            <span
              key={word.text}
              className="knowledge-gather-word"
              style={{
                left: word.left,
                top: word.top,
                "--gather-x": word.x,
                "--gather-y": word.y
              } as CSSProperties}
            >
              {word.text}
            </span>
          ))}
          <div className="relative mx-auto flex w-fit items-center gap-3 rounded-full border border-white/75 bg-white/70 px-5 py-3 shadow-soft backdrop-blur">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-emerald-400 text-lg font-bold text-white shadow-glow">
              X
            </div>
            <div className="text-left">
              <h1 className="text-xl font-semibold tracking-normal">X-RAG 知识库平台</h1>
              <p className="text-xs text-slate-500">让知识流动，让业务变强</p>
            </div>
          </div>
          <p className="mt-4 text-base font-medium text-slate-700">让知识流动，让业务变强</p>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            让企业知识从分散资料，变成可信、可用、可治理的知识资产。
          </p>
        </section>

        <section className="w-full rounded-3xl border border-white/80 bg-white/[0.82] p-5 shadow-soft backdrop-blur-xl md:p-7">
          <div className="mx-auto max-w-5xl text-center">
            <Badge className="border-transparent bg-indigo-50 text-indigo-700">前端 Mock 演示登录</Badge>
            <h2 className="mt-3 text-2xl font-semibold tracking-normal">欢迎登录</h2>
            <p className="mt-2 text-sm text-slate-500">请选择演示身份，不同角色可看到不同的功能与数据范围。</p>
            {currentUser && (
              <div className="mx-auto mt-4 flex w-fit flex-wrap items-center justify-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm">
                <span>当前身份：{currentUser.name} · {currentUser.roleName}</span>
                <Button size="sm" onClick={() => navigate(defaultRedirect)}>
                  进入工作台
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {DEMO_USERS.map((user) => (
              <RoleLoginCard
                key={user.id}
                user={user}
                loading={loadingRole === user.id}
                onLogin={() => completeLogin(user.id)}
                {...roleMeta[user.id as keyof typeof roleMeta]}
              />
            ))}
          </div>

          <div className="my-7 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs font-medium text-slate-400">或使用账号登录</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <form onSubmit={submitPasswordLogin} className="mx-auto grid max-w-3xl gap-3 md:grid-cols-[1fr_1fr_auto]">
            <label className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="账号 / 邮箱 / 手机号" className="h-11 rounded-2xl bg-white pl-10" />
            </label>
            <label className="relative">
              <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="密码" className="h-11 rounded-2xl bg-white pl-10" />
            </label>
            <Button type="submit" className="h-11 rounded-2xl px-7">
              登录
            </Button>
            <div className="md:col-span-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
              <label className="flex items-center gap-2">
                <input checked={remember} onChange={(event) => setRemember(event.target.checked)} type="checkbox" className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
                记住我
              </label>
              <button type="button" className="hover:text-indigo-600" onClick={() => addToast({ title: "演示环境暂不接入找回密码。", type: "info" })}>
                忘记密码
              </button>
            </div>
          </form>

          <div className="mt-7 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4">
            <div className="flex items-center justify-center gap-2 text-sm font-semibold text-slate-800">
              <Waves className="h-4 w-4 text-indigo-500" />
              角色权限对比
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {roleComparison.map((item) => (
                <div key={item.role} className="rounded-2xl bg-white p-4 shadow-sm">
                  <p className="font-medium text-slate-900">{item.role}</p>
                  <div className="mt-3 space-y-2">
                    {item.items.map((text) => (
                      <p key={text} className="flex gap-2 text-sm leading-5 text-slate-600">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                        {text}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="flex items-center gap-2 rounded-full bg-white/60 px-4 py-2 text-xs text-slate-500 backdrop-blur">
          <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
          Mock 账号：super_admin / marketing_admin / hr_admin，密码均为 123456
        </div>
      </main>
      <ToastViewport />
    </div>
  );
}
