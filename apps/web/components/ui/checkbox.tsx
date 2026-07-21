"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/* Checkbox kit kontrol — 16px, centang dibuat dengan pseudo-border */
function Checkbox({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        "relative size-4 flex-none cursor-pointer appearance-none rounded border-[1.5px] border-(--border-input) bg-(--fill-input) transition-colors",
        "checked:border-(--color-primary) checked:bg-(--color-primary)",
        /* centang ✓: persegi 4.5×9 ber-border kanan+bawah dirotasi 45° —
           lengan pendek + panjang (bukan chevron simetris) */
        "checked:after:absolute checked:after:top-[0.5px] checked:after:left-[4.5px] checked:after:h-[9px] checked:after:w-[4.5px] checked:after:rotate-45 checked:after:border-0 checked:after:border-r-2 checked:after:border-b-2 checked:after:border-solid checked:after:border-(--color-on-cta) checked:after:content-['']",
        "indeterminate:border-(--color-primary) indeterminate:bg-(--color-primary) indeterminate:after:absolute indeterminate:after:top-1.5 indeterminate:after:right-[3px] indeterminate:after:left-[3px] indeterminate:after:h-0.5 indeterminate:after:bg-(--color-on-cta) indeterminate:after:content-['']",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary)",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

/* Baris toggle: checkbox + label satu baris */
function ToggleRow({
  className,
  children,
  ...props
}: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="toggle-row"
      className={cn(
        "flex cursor-pointer items-center gap-2 text-sm",
        className
      )}
      {...props}
    >
      {children}
    </label>
  );
}

export { Checkbox, ToggleRow };
