"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/* Drawer kanan (riwayat status unit) */
function Drawer({
  open,
  onClose,
  labelledBy,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy?: string;
  className?: string;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div role="presentation" className="fixed inset-0 z-100">
      <div
        className="absolute inset-0 bg-(--scrim) backdrop-blur-xs"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cn(
          "absolute top-0 right-0 bottom-0 w-[min(440px,92vw)] overflow-y-auto border-l border-(--glass-2-border) bg-(--overlay-fill) p-6 shadow-(--shadow-modal)",
          className
        )}
      >
        {children}
      </aside>
    </div>
  );
}

function DrawerClose({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      data-slot="drawer-close"
      className={cn(
        "size-8 flex-none cursor-pointer rounded-lg bg-(--fill-hover) text-sm text-(--text-secondary) hover:bg-(--fill-hover-strong) hover:text-(--text-primary)",
        className
      )}
      {...props}
    >
      ✕
    </button>
  );
}

/* Timeline riwayat (tl) — garis kiri + titik berwarna status */
function Timeline({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="timeline"
      className={cn(
        "relative m-0 list-none p-0 before:absolute before:top-2 before:bottom-2 before:left-[7px] before:w-px before:bg-(--divider) before:content-['']",
        className
      )}
      {...props}
    />
  );
}

function TimelineItem({
  dotColor,
  when,
  what,
  why,
}: {
  dotColor: string;
  when: React.ReactNode;
  what: React.ReactNode;
  why?: React.ReactNode;
}) {
  return (
    <li className="relative pb-5 pl-6 last:pb-0">
      <span
        className="absolute top-1 left-0.5 size-[11px] rounded-full border-2 bg-(--overlay-fill)"
        style={{ borderColor: dotColor }}
      />
      <div className="font-mono text-xs text-(--text-tertiary)">{when}</div>
      <div className="mt-0.5 text-sm font-semibold">{what}</div>
      {why ? (
        <div className="mt-0.5 text-xs leading-normal text-(--text-secondary)">
          {why}
        </div>
      ) : null}
    </li>
  );
}

export { Drawer, DrawerClose, Timeline, TimelineItem };
