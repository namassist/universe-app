"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/* Dropzone unggah berkas — border putus-putus, ikon kaca, drag highlight */
function Dropzone({
  icon,
  title,
  hint,
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
  onPick?: () => void;
  onDropFile?: (name: string) => void;
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
        const name = e.dataTransfer.files?.[0]?.name;
        if (name) onDropFile?.(name);
      }}
      className={cn(
        "cursor-pointer rounded-card border-[1.5px] border-dashed border-(--border-input) bg-(--fill-input) p-6 text-center transition-[border-color,background-color] duration-150 hover:border-(--color-primary) hover:bg-[rgba(0,212,255,.07)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary)",
        dragging && "border-(--color-primary) bg-[rgba(0,212,255,.07)]",
        className
      )}
    >
      <div className="mx-auto mb-3 grid size-11 place-items-center rounded-icon border border-(--glass-2-border) bg-(--glass-2-fill) [&_svg]:size-5 [&_svg]:text-(--color-primary-bright)">
        {icon}
      </div>
      <b className="block text-sm font-semibold">{title}</b>
      {hint ? (
        <span className="mt-1 block text-xs text-(--text-tertiary)">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export { Dropzone };
