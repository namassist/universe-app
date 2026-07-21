"use client";

import * as React from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/* Menu jatuh header (hdrop/fmenu) — overlay nyaris opaque, posisi kanan-bawah trigger.
   Wrapper harus relative; klik di luar & Escape menutup. */
function DropMenuWrap({
  open,
  onClose,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <div ref={ref} className={cn("relative", className)}>
      {children}
    </div>
  );
}

function DropMenu({
  open,
  className,
  role = "menu",
  ...props
}: React.ComponentProps<"div"> & { open: boolean }) {
  if (!open) return null;
  return (
    <div
      role={role}
      data-slot="drop-menu"
      className={cn(
        "absolute top-[calc(100%+10px)] right-0 z-80 w-70 rounded-icon border border-(--glass-2-border) bg-(--overlay-fill) p-2 shadow-(--shadow-modal)",
        className
      )}
      {...props}
    />
  );
}

/* Item menu radio dengan tanda centang kanan */
function DropMenuRadio({
  checked,
  className,
  children,
  ...props
}: React.ComponentProps<"button"> & { checked?: boolean }) {
  return (
    <button
      role="menuitemradio"
      aria-checked={checked}
      className={cn(
        "flex h-9 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-left text-[13px] font-medium tracking-(--tracking-brand) text-(--text-secondary) hover:bg-(--fill-hover) hover:text-(--text-primary)",
        className
      )}
      {...props}
    >
      {children}
      <Check
        strokeWidth={2.5}
        className={cn(
          "ml-auto size-3.5 flex-none text-(--color-primary-bright)",
          checked ? "opacity-100" : "opacity-0"
        )}
      />
    </button>
  );
}

function DropMenuItem({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      role="menuitem"
      className={cn(
        "flex h-9.5 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-left text-[13px] font-medium tracking-(--tracking-brand) text-(--text-secondary) hover:bg-(--fill-hover) hover:text-(--text-primary) [&_svg]:size-[15px]",
        className
      )}
      {...props}
    />
  );
}

function DropMenuHeading({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "px-3 py-2 text-xs font-semibold tracking-[.05em] text-(--text-tertiary) uppercase",
        className
      )}
      {...props}
    />
  );
}

export { DropMenuWrap, DropMenu, DropMenuRadio, DropMenuItem, DropMenuHeading };
