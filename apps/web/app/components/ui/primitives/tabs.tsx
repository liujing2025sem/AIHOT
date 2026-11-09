import type { ComponentProps } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "../../../lib/cn";

export function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root {...props} className={cn("min-w-0", className)} />;
}

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List {...props} className={cn("inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-control bg-bg-sunk p-1 text-ink-3", className)} />;
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger {...props} className={cn("inline-flex min-h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-[6px] px-3 py-1.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 data-[state=active]:bg-surface data-[state=active]:text-ink data-[state=active]:shadow-sm", className)} />;
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content {...props} className={cn("mt-4 min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-accent", className)} />;
}
