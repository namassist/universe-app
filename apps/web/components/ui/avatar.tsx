import * as React from "react";

import { cn } from "@/lib/utils";

/* Avatar inisial dengan gradient cyan + ring */
function Avatar({
  className,
  children,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar"
      className={cn(
        "grid size-9 place-items-center rounded-full bg-(image:--gradient-cta) text-[13px] font-bold text-on-cta shadow-[0_0_0_2px_var(--ring-avatar)]",
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}

/* Ambil inisial dua kata pertama */
export function initialsOf(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export { Avatar };
