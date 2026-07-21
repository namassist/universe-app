"use client";

import * as React from "react";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";

/* Kotak pencarian toolbar — ikon kaca pembesar + tombol bersihkan opsional */
function SearchInput({
  className,
  inputClassName,
  onClear,
  clearLabel,
  value,
  ...props
}: React.ComponentProps<"input"> & {
  inputClassName?: string;
  onClear?: () => void;
  clearLabel?: string;
}) {
  const hasValue = typeof value === "string" && value.length > 0;
  return (
    <div
      data-slot="search"
      className={cn(
        "flex h-10 w-65 items-center gap-2 rounded-control border border-(--border-input) bg-(--fill-input) px-3 backdrop-blur-md transition-[border-color,box-shadow] duration-150 focus-within:border-primary focus-within:shadow-[0_0_0_3px_rgba(0,212,255,.22)]",
        className
      )}
    >
      <Search className="size-[15px] flex-none text-(--text-tertiary)" />
      <input
        type="search"
        value={value}
        className={cn(
          "min-w-0 flex-1 border-none bg-transparent text-sm tracking-(--tracking-brand) text-(--text-primary) outline-none placeholder:text-(--text-tertiary) [&::-webkit-search-cancel-button]:hidden",
          inputClassName
        )}
        {...props}
      />
      {onClear && hasValue ? (
        <button
          type="button"
          onClick={onClear}
          aria-label={clearLabel}
          className="grid size-5 flex-none cursor-pointer place-items-center rounded-full bg-(--fill-hover-strong) text-[11px] leading-none text-(--text-secondary) hover:text-(--text-primary)"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}

export { SearchInput };
