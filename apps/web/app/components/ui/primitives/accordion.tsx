import type { ComponentProps } from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";
import { cn } from "../../../lib/cn";

export const Accordion = AccordionPrimitive.Root;

export function AccordionItem({ className, ...props }: ComponentProps<typeof AccordionPrimitive.Item>) {
  return <AccordionPrimitive.Item {...props} className={cn("border-b border-line last:border-b-0", className)} />;
}

export function AccordionTrigger({ className, children, ...props }: ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger {...props} className={cn("group flex w-full items-center justify-between gap-3 rounded-control py-4 text-left text-sm font-medium text-ink outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-accent", className)}>
        {children}<ChevronDown className="size-4 shrink-0 text-ink-3 group-data-[state=open]:rotate-180" aria-hidden="true" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

export function AccordionContent({ className, children, ...props }: ComponentProps<typeof AccordionPrimitive.Content>) {
  return <AccordionPrimitive.Content {...props} className="overflow-hidden text-sm"><div className={cn("pb-4 leading-relaxed text-ink-2", className)}>{children}</div></AccordionPrimitive.Content>;
}
