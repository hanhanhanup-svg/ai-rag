import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SectionCardProps {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function SectionCard({ title, description, actions, children, className, contentClassName }: SectionCardProps) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      {(title || description || actions) && (
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            {title && <CardTitle>{title}</CardTitle>}
            {description && <CardDescription className="mt-1">{description}</CardDescription>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </CardHeader>
      )}
      <CardContent className={cn(title || description || actions ? "" : "pt-5", contentClassName)}>{children}</CardContent>
    </Card>
  );
}
