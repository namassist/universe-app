"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * "pill" (default): the filter segmented (seg) — a grouped pill, the active
 * option lit cyan. "tabs": the same choice drawn as an underlined tab row, for
 * a switch between views of one panel, so it cannot be mistaken for one more
 * filter beside a pill. The row scrolls sideways rather than wrapping.
 */
type SegmentedVariant = "pill" | "tabs";

const VariantContext = React.createContext<SegmentedVariant>("pill");

function Segmented({
  className,
  variant = "pill",
  ...props
}: React.ComponentProps<"div"> & { variant?: SegmentedVariant }) {
  return (
    <VariantContext.Provider value={variant}>
      <div
        data-slot="segmented"
        data-variant={variant}
        className={cn(
          variant === "tabs"
            ? "flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--divider)]"
            : "inline-flex gap-1 rounded-control border border-(--divider) bg-(--fill-input) p-1",
          className
        )}
        {...props}
      />
    </VariantContext.Provider>
  );
}

function SegmentedButton({
  className,
  active,
  ...props
}: React.ComponentProps<"button"> & { active?: boolean }) {
  const variant = React.useContext(VariantContext);
  return (
    <button
      data-slot="segmented-button"
      className={cn(
        "cursor-pointer font-semibold tracking-(--tracking-brand) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
        variant === "tabs"
          ? [
              "flex-none border-b-2 px-3.5 pt-2 pb-3 text-sm whitespace-nowrap transition-colors duration-150",
              active
                ? "border-primary text-primary-bright"
                : "border-transparent text-(--text-secondary) hover:text-(--text-primary)",
            ]
          : [
              "rounded-lg border border-transparent px-3.5 py-[7px] text-[13px]",
              active
                ? "border-[rgba(0,212,255,.4)] bg-[rgba(0,212,255,.12)] text-primary-bright"
                : "text-(--text-secondary) hover:bg-(--fill-hover) hover:text-(--text-primary)",
            ],
        className
      )}
      {...props}
    />
  );
}

export { Segmented, SegmentedButton };
