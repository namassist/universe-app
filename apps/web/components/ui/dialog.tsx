"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/* Dialog G2-overlay: scrim blur + kartu nyaris opaque.
   Tutup lewat klik scrim atau Escape (ditangani provider halaman). */
function Dialog({
  open,
  onClose,
  className,
  labelledBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  className?: string;
  labelledBy?: string;
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
    <div
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-100 grid place-items-center bg-(--scrim) p-6 backdrop-blur-[6px]"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cn(
          /* flex-col + max-h viewport: konten panjang scroll di area min-h-0,
             tombol aksi tetap terlihat di layar pendek */
          "flex max-h-[calc(100dvh-48px)] w-[min(460px,100%)] flex-col rounded-panel border border-(--glass-2-border) bg-(--overlay-fill) p-6 shadow-(--shadow-modal)",
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}

/* Ikon dialog 44px — varian info (cyan) / warning / danger */
function DialogIcon({
  variant = "info",
  className,
  children,
}: {
  variant?: "info" | "warning" | "danger";
  className?: string;
  children: React.ReactNode;
}) {
  const styles = {
    info: "border-[rgba(0,212,255,.4)] bg-[rgba(0,212,255,.14)] [&_svg]:text-(--color-primary-bright)",
    warning:
      "border-(--badge-warning-border) bg-(--badge-warning-fill) [&_svg]:text-(--badge-warning-text)",
    danger:
      "border-(--badge-danger-border) bg-(--badge-danger-fill) [&_svg]:text-(--color-danger-text)",
  }[variant];
  return (
    <div
      className={cn(
        "mb-4 grid size-11 place-items-center rounded-icon border [&_svg]:size-5",
        styles,
        className
      )}
    >
      {children}
    </div>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="dialog-title"
      className={cn("text-xl leading-snug font-semibold", className)}
      {...props}
    />
  );
}

function DialogBody({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="dialog-body"
      className={cn(
        "mt-2 text-sm leading-relaxed text-(--text-secondary)",
        className
      )}
      {...props}
    />
  );
}

function DialogActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-actions"
      className={cn("mt-6 flex flex-none justify-end gap-2", className)}
      {...props}
    />
  );
}

export { Dialog, DialogIcon, DialogTitle, DialogBody, DialogActions };
