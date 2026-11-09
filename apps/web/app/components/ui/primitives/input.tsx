import type { ComponentProps } from "react";
import { cn } from "../../../lib/cn";

export const fieldClasses = "w-full rounded-control border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none transition-shadow placeholder:text-ink-4 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 disabled:cursor-not-allowed disabled:bg-bg-sunk disabled:opacity-60 aria-invalid:border-hot aria-invalid:ring-hot/20";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={cn(fieldClasses, "min-h-10", className)} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={cn(fieldClasses, "min-h-24 resize-y leading-relaxed", className)} />;
}
