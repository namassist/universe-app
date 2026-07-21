import * as React from "react";

import { cn } from "@/lib/utils";

/* Kit kontrol .ctrl — input teks/date/time */
const ctrlClass =
  "w-full h-10 rounded-control border border-(--border-input) bg-(--fill-input) px-4 text-sm text-(--text-primary) tracking-(--tracking-brand) backdrop-blur-md transition-[border-color,box-shadow] duration-150 placeholder:text-(--text-tertiary) focus:outline-none focus:border-(--color-primary) focus:shadow-[0_0_0_3px_rgba(0,212,255,.22),0_5px_15px_rgba(0,212,255,.25)] disabled:cursor-not-allowed disabled:text-(--text-disabled) disabled:bg-(--fill-subtle) disabled:border-(--fill-hover-strong)";

function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input data-slot="input" className={cn(ctrlClass, className)} {...props} />
  );
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        ctrlClass,
        "h-auto min-h-22 resize-y px-4 py-3 leading-normal",
        className
      )}
      {...props}
    />
  );
}

export { Input, Textarea, ctrlClass };
