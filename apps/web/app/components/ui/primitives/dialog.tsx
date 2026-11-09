import type { ComponentProps } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../../../lib/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export function DialogContent({ className, children, side, showClose = true, ...props }: ComponentProps<typeof DialogPrimitive.Content> & { side?: "left" | "right"; showClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[75] bg-black/35 data-[state=open]:animate-none" />
      <DialogPrimitive.Content {...props} className={cn(
        "fixed z-[76] overflow-y-auto bg-raised p-6 text-ink shadow-2xl outline-none",
        side ? "inset-y-0 w-[min(360px,calc(100%_-_32px))] border-line" : "left-1/2 top-1/2 max-h-[calc(100dvh_-_32px)] w-[calc(100%_-_32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-sheet border border-line-strong",
        side === "left" && "left-0 border-r", side === "right" && "right-0 border-l", className,
      )}>
        {children}
        {showClose && <DialogPrimitive.Close className="absolute right-4 top-4 inline-flex size-8 items-center justify-center rounded-control text-ink-3 hover:bg-bg-sunk hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label="关闭对话框"><X className="size-4" aria-hidden="true" /></DialogPrimitive.Close>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title {...props} className={cn("pr-8 text-lg font-semibold tracking-tight", className)} />;
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description {...props} className={cn("mt-2 text-sm leading-relaxed text-ink-3", className)} />;
}

export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("mb-5", className)} />;
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("mt-6 flex flex-wrap justify-end gap-2", className)} />;
}
