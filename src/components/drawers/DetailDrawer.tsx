import type { ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  widthClassName?: string;
}

export function DetailDrawer({ open, onOpenChange, title, description, children, footer, widthClassName }: DetailDrawerProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className={cn(
            "fixed right-0 top-0 z-50 flex h-full w-[680px] max-w-[calc(100vw-2rem)] flex-col bg-white shadow-soft focus:outline-none",
            widthClassName
          )}
        >
          <div className="flex items-start justify-between border-b px-6 py-5">
            <div>
              <DialogPrimitive.Title className="text-lg font-semibold text-slate-950">{title}</DialogPrimitive.Title>
              {description && <DialogPrimitive.Description className="mt-1 text-sm text-slate-500">{description}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </div>
          <div className="subtle-scrollbar flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="border-t bg-slate-50 px-6 py-4">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
