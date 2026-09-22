import { Badge } from "@/components/ui/badge";
import type { StatusTone } from "@/types";

const statusToneMap: Record<string, StatusTone> = {
  正常: "success",
  注意: "warning",
  停用: "muted",
  待审核: "warning",
  已通过: "success",
  已驳回: "danger",
  已超时: "danger",
  解析中: "normal",
  已完成: "success",
  失败: "danger",
  运行中: "success",
  草稿: "muted",
  启用: "success",
  限流中: "warning"
};

const variantMap: Record<StatusTone, "default" | "secondary" | "success" | "warning" | "danger" | "outline"> = {
  normal: "default",
  attention: "warning",
  success: "success",
  warning: "warning",
  danger: "danger",
  muted: "secondary"
};

export function StatusBadge({ status, tone }: { status: string; tone?: StatusTone }) {
  return <Badge variant={variantMap[tone ?? statusToneMap[status] ?? "normal"]}>{status}</Badge>;
}
