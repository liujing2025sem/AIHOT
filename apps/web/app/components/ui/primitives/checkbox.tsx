import type { ComponentProps } from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "../../../lib/cn";

export function Checkbox({ className, checked, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root {...props} checked={checked} className={cn("peer inline-flex size-5 shrink-0 items-center justify-center rounded-[5px] border border-line-strong bg-surface text-accent-contrast shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent disabled:cursor-not-allowed disabled:opacity-50", className)}>
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        {checked === "indeterminate" ? <Minus className="size-3.5" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
