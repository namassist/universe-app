"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/* Dropzone unggah berkas — border putus-putus, ikon kaca, drag highlight */
function Dropzone({
  icon,
  title,
  hint,
  compact,
  onPick,
  onDropFile,
  dragging,
  onDragChange,
  className,
  "aria-label": ariaLabel,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  hint?: React.ReactNode;
  /**
   * Icon beside the text instead of above it, for a zone that has to sit at a
   * given height rather than take the height its contents want.
   *
   * The stacked default is right when the dropzone is the page's main event —
   * an import screen, where it is the only thing to do. Beside a 96px avatar it
   * is not: the two are one control, and a zone twice the height of the photo
   * it replaces reads as two unrelated boxes.
   */
  compact?: boolean;
  onPick?: () => void;
  /**
   * The dropped file's name, and the file itself.
   *
   * The name is first because most callers only display it; the `File` is what
   * a caller that actually uploads on drop needs, and reading it back off a
   * hidden input is not possible — a drop never touches one.
   */
  onDropFile?: (name: string, file: File) => void;
  dragging?: boolean;
  onDragChange?: (dragging: boolean) => void;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div
      tabIndex={0}
      role="button"
      aria-label={ariaLabel}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick?.();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        onDragChange?.(true);
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        onDragChange?.(true);
      }}
      onDragLeave={() => onDragChange?.(false)}
      onDrop={(e) => {
        e.preventDefault();
        onDragChange?.(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onDropFile?.(file.name, file);
      }}
      className={cn(
        "group cursor-pointer rounded-card border-[1.5px] border-dashed border-(--border-input) bg-(--fill-input) transition-[border-color,background-color,transform] duration-150 hover:border-(--color-primary) hover:bg-[rgba(0,212,255,.07)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary)",
        compact ? "flex items-center gap-4 px-5" : "p-6 text-center",
        /* The zone leans toward a file held over it. Transform rather than a
           size change, so nothing around it reflows mid-drag. */
        dragging &&
          "scale-[1.01] border-(--color-primary) bg-[rgba(0,212,255,.07)]",
        className
      )}
    >
      <div
        className={cn(
          "grid size-11 flex-none place-items-center rounded-icon border border-(--glass-2-border) bg-(--glass-2-fill) transition-transform duration-200 group-hover:-translate-y-0.5 [&_svg]:size-5 [&_svg]:text-(--color-primary-bright)",
          !compact && "mx-auto mb-3"
        )}
      >
        {icon}
      </div>
      {/* `min-w-0` so a long title truncates instead of stretching the row.
          Truncation is compact-only: the stacked variant has the width to wrap,
          and clipping an import screen's instructions would be a regression. */}
      <div className="min-w-0">
        <b className={cn("block text-sm font-semibold", compact && "truncate")}>
          {title}
        </b>
        {hint ? (
          <span className="mt-1 block text-xs text-(--text-tertiary)">
            {hint}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export { Dropzone };
