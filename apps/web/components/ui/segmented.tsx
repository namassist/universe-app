"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/* Filter segmented (seg) — pill grup dengan opsi aktif cyan */
function Segmented({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="segmented"
      className={cn(
        "inline-flex gap-1 rounded-control border border-(--divider) bg-(--fill-input) p-1",
        className
      )}
      {...props}
    />
  );
}

function SegmentedButton({
  className,
  active,
  ...props
}: React.ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      data-slot="segmented-button"
      className={cn(
        "cursor-pointer rounded-lg border border-transparent px-3.5 py-[7px] text-[13px] font-semibold tracking-(--tracking-brand) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
        active
          ? "border-[rgba(0,212,255,.4)] bg-[rgba(0,212,255,.12)] text-primary-bright"
          : "text-(--text-secondary) hover:bg-(--fill-hover) hover:text-(--text-primary)",
        className
      )}
      {...props}
    />
  );
}

export { Segmented, SegmentedButton };
