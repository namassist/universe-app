import * as React from "react";

import { cn } from "@/lib/utils";

/* Bar progres upload (prog) */
function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div
      data-slot="progress"
      className={cn("h-2 overflow-hidden rounded bg-(--fill-hover)", className)}
    >
      <span
        className="block h-full rounded bg-(image:--gradient-cta) transition-[width] duration-200"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

export { Progress };
