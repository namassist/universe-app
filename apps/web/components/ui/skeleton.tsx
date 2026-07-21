import * as React from "react";

import { cn } from "@/lib/utils";

/* Shimmer skeleton (sk) */
function Skeleton({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="skeleton"
      className={cn(
        "block animate-shimmer rounded-[7px] bg-[linear-gradient(90deg,var(--sk-base)_25%,var(--sk-hi)_50%,var(--sk-base)_75%)] bg-size-[200%_100%]",
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };
