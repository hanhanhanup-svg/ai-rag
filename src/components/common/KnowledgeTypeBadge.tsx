import { Badge } from "@/components/ui/badge";
import type { KnowledgeType } from "@/types";

const typeVariant: Record<string, "default" | "secondary" | "success" | "warning" | "outline"> = {
  FAQ: "default",
  SOP: "success",
  text_chunk: "warning",
  实体: "outline",
  政策: "secondary",
  合同: "outline",
  合规: "warning"
};

export function KnowledgeTypeBadge({ type }: { type: KnowledgeType | string }) {
  return <Badge variant={typeVariant[type] ?? "secondary"}>{type}</Badge>;
}
