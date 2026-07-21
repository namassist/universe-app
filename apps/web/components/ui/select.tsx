import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

import { ctrlClass } from "./input";

/* Select native bergaya kit kontrol — chevron konsisten menggantikan panah OS */
function Select({
  className,
  wrapperClassName,
  children,
  ...props
}: React.ComponentProps<"select"> & { wrapperClassName?: string }) {
  return (
    <span className={cn("relative inline-flex w-full", wrapperClassName)}>
      <select
        data-slot="select"
        className={cn(
          ctrlClass,
          "cursor-pointer appearance-none pr-9.5 [&_option]:bg-(--overlay-fill) [&_option]:text-(--text-primary)",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-[15px] -translate-y-1/2 text-(--text-secondary)" />
    </span>
  );
}

export { Select };
