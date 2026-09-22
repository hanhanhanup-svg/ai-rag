import { Badge } from "@/components/ui/badge";
import type { SensitivityLevel } from "@/types";

const variants: Record<SensitivityLevel, "success" | "default" | "warning" | "danger"> = {
  公开: "success",
  内部: "default",
  机密: "warning",
  绝密: "danger"
};

export function SensitivityBadge({ level }: { level: SensitivityLevel }) {
  return <Badge variant={variants[level]}>{level}</Badge>;
}
