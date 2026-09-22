import { useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { qualityRules } from "@/data/mock/quality";
import { useAppStore } from "@/store/useAppStore";

const extraRules = [
  { id: "rule-tags", name: "标签缺失", description: "知识条目缺少业务标签，影响分类过滤和知识地图分析。", tags: ["扣分", "提示"], triggers7d: 12, enabled: true },
  { id: "rule-duplicate", name: "重复冲突", description: "存在相似知识或答案冲突，需要合并或确认保留策略。", tags: ["扣分", "高风险"], triggers7d: 4, enabled: true },
  { id: "rule-sensitive", name: "密级缺失", description: "未设置访问密级，可能影响权限控制和合规治理。", tags: ["扣分", "警告"], triggers7d: 3, enabled: false }
];

const ruleMeta: Record<string, { type: string; weight: string; risk: string; impact: string }> = {
  "缺少问题变体": { type: "FAQ", weight: "-8", risk: "中", impact: "影响用户自然问法召回和问答命中率。" },
  "来源不清晰": { type: "全部类型", weight: "-10", risk: "高", impact: "影响可信引用和审核追溯。" },
  "已过期未处理": { type: "全部类型", weight: "-12", risk: "高", impact: "旧知识可能继续影响搜索和问答结果。" },
  "摘要为空": { type: "FAQ / SOP / text_chunk", weight: "-8", risk: "中", impact: "影响搜索结果理解和答案引用效果。" },
  "标签缺失": { type: "全部类型", weight: "-5", risk: "中", impact: "影响分类管理、检索过滤和知识地图分析。" },
  "重复冲突": { type: "FAQ / SOP", weight: "-12", risk: "高", impact: "可能导致同一问题返回不一致答案。" },
  "密级缺失": { type: "全部类型", weight: "-10", risk: "高", impact: "影响权限控制和知识安全边界。" }
};

export default function QualityRulesPage() {
  const [rules, setRules] = useState([...qualityRules, ...extraRules]);
  const [open, setOpen] = useState(false);
  const addToast = useAppStore((state) => state.addToast);

  const enabledCount = rules.filter((rule) => rule.enabled).length;
  const triggerCount = rules.reduce((sum, rule) => sum + rule.triggers7d, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="治理规则"
        description={`配置知识体检规则，定义哪些问题会影响知识健康度和问答效果。已启用 ${enabledCount} 条规则，近 7 天共触发 ${triggerCount} 次。`}
        actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />新建规则</Button>}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rules.map((rule) => {
          const meta = ruleMeta[rule.name] ?? { type: "全部类型", weight: "-6", risk: "中", impact: rule.description };

          return (
            <SectionCard key={rule.id} title={rule.name} description={meta.impact}>
              <div className="grid gap-3 text-sm text-slate-600">
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                  <span>适用知识类型</span>
                  <span className="font-medium text-slate-900">{meta.type}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">扣分权重</p>
                    <p className="mt-1 font-semibold text-slate-950">{meta.weight}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">风险等级</p>
                    <p className="mt-1 font-semibold text-slate-950">{meta.risk}</p>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {rule.tags.map((tag) => <Badge key={tag} variant={tag === "高风险" || tag === "警告" ? "warning" : "secondary"}>{tag}</Badge>)}
              </div>
              <div className="mt-5 flex items-center justify-between rounded-2xl bg-slate-50 p-4">
                <div>
                  <p className="text-sm text-slate-500">近 7 天触发次数</p>
                  <p className="mt-1 text-2xl font-semibold">{rule.triggers7d} 次</p>
                </div>
                <Switch
                  checked={rule.enabled}
                  onCheckedChange={(checked) => {
                    setRules((items) => items.map((item) => (item.id === rule.id ? { ...item, enabled: checked } : item)));
                    addToast({ title: checked ? "治理规则已启用" : "治理规则已关闭", description: rule.name, type: "success" });
                  }}
                />
              </div>
            </SectionCard>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建治理规则</DialogTitle>
            <DialogDescription>定义体检条件、扣分权重和修复建议，规则可先以关闭状态保存。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <label className="space-y-2 text-sm font-medium">
              <span>规则名称</span>
              <Input placeholder="例如：缺少来源依据" />
            </label>
            <label className="space-y-2 text-sm font-medium">
              <span>适用知识类型</span>
              <Select defaultValue="FAQ">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["FAQ", "SOP", "text_chunk", "全部类型"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-2 text-sm font-medium">
              <span>体检条件</span>
              <Textarea placeholder="例如：source_file 为空或来源说明为空" />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 text-sm font-medium">
                <span>扣分权重</span>
                <Input placeholder="10" />
              </label>
              <label className="space-y-2 text-sm font-medium">
                <span>风险等级</span>
                <Select defaultValue="警告">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["提示", "警告", "高风险"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
            </div>
            <label className="space-y-2 text-sm font-medium">
              <span>修复建议</span>
              <Textarea placeholder="例如：补充文档名称、URL 或原文段落引用" />
            </label>
            <label className="flex items-center justify-between rounded-2xl bg-slate-50 p-4 text-sm font-medium">
              <span>是否启用</span>
              <Switch />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={() => {
              setOpen(false);
              addToast({ title: "治理规则已创建", description: "新规则已保存，可在列表中启用。", type: "success" });
            }}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
